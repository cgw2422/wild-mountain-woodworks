import "server-only";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { formatCents } from "@/lib/money";
import { getSettings, salesFlags } from "@/lib/settings";
import { siteUrl } from "@/lib/site-url";
import { SalesError } from "./errors";
import { getInvoicingProvider } from "./stripe";

/**
 * Deposit payment through Stripe Checkout (payment mode).
 *
 * The amount is always the unpaid balance of the order's DEPOSIT invoice —
 * itself frozen from the accepted quote revision — never anything from the
 * browser. One Checkout Session is kept per invoice: an open one is reused,
 * an expired one is replaced, and the attempt counter is part of the Stripe
 * idempotency key so simultaneous clicks share a session. Payment is only
 * recorded from verified webhooks (payments.ts), never from the redirect.
 */

export type CheckoutStart =
  | { kind: "redirect"; url: string }
  | { kind: "nothing_due" }
  | { kind: "processing" }
  | { kind: "offline" }
  | { kind: "error"; message: string };

/** The deposit request for an order (not void/canceled), if any. */
export function depositInvoiceFor(orderId: string) {
  return prisma.invoice.findFirst({ where: { orderId, kind: "DEPOSIT", status: { notIn: ["VOID", "CANCELED"] } }, orderBy: { createdAt: "asc" } });
}

/** Stable Wild Mountain link that always leads to a valid deposit checkout. */
export function depositPayPath(orderToken: string) {
  return `/order/${orderToken}/pay`;
}

export async function startDepositCheckout(orderToken: string): Promise<CheckoutStart> {
  const order = await prisma.order.findUnique({
    where: { customerToken: orderToken },
    include: { quote: { select: { id: true, number: true } }, acceptedRevision: { select: { number: true } } },
  });
  if (!order || order.productionStatus === "CANCELED") return { kind: "nothing_due" };
  const invoice = await depositInvoiceFor(order.id);
  const due = invoice ? invoice.totalCents - invoice.amountPaidCents : 0;
  if (!invoice || due <= 0 || ["PAID", "DRAFT"].includes(invoice.status)) return { kind: "nothing_due" };

  const flags = salesFlags(await getSettings());
  const provider = getInvoicingProvider();
  if (!flags.onlinePayments || !provider) return { kind: "offline" };
  // A deposit already sent as a Stripe invoice is paid on its hosted page, never twice.
  if (invoice.stripeHostedInvoiceUrl) return { kind: "redirect", url: invoice.stripeHostedInvoiceUrl };

  // Reuse the current session while it's open and still for the right amount.
  if (invoice.stripeCheckoutSessionId) {
    try {
      const current = await provider.retrieveCheckoutSession(invoice.stripeCheckoutSessionId);
      if (current.status === "complete") {
        await prisma.invoice.update({ where: { id: invoice.id }, data: { stripeCheckoutStatus: current.paymentStatus === "paid" ? "complete" : "processing" } });
        return { kind: "processing" };
      }
      if (current.status === "open" && current.url && current.amountTotal === due && (!current.expiresAt || current.expiresAt.getTime() > Date.now() + 60_000)) {
        return { kind: "redirect", url: current.url };
      }
      if (current.status === "open") await provider.expireCheckoutSession(current.id).catch(() => undefined);
    } catch (error) {
      logger.error("Could not check the Stripe Checkout session", { error, invoiceId: invoice.id });
      return { kind: "error", message: "We couldn't reach our payment provider. Please try again in a moment." };
    }
  }

  const attempt = invoice.checkoutAttempts + 1;
  const metadata = {
    payment_type: "deposit",
    invoice_id: invoice.id,
    invoice_number: invoice.number,
    order_id: order.id,
    order_number: order.number,
    quote_id: order.quote?.id ?? "",
    quote_number: order.quote?.number ?? "",
    quote_revision: String(order.acceptedRevision?.number ?? ""),
    customer_id: order.customerId ?? "",
  };
  try {
    const session = await provider.createCheckoutSession({
      idempotencyKey: `wm-deposit-${invoice.id}-${attempt}-${due}`,
      amountCents: due,
      productName: `Deposit — order ${order.number}`,
      description: `Deposit for Wild Mountain Woodworks order ${order.number}${order.quote?.number ? ` (quote ${order.quote.number})` : ""}`,
      customerEmail: order.customerEmail,
      clientReferenceId: invoice.id,
      successUrl: siteUrl(`/order/${orderToken}/payment-success?session_id={CHECKOUT_SESSION_ID}`),
      cancelUrl: siteUrl(`/order/${orderToken}?payment=canceled`),
      metadata,
    });
    // Only the first of two simultaneous requests bumps the counter; both got the same session.
    await prisma.invoice.updateMany({
      where: { id: invoice.id, checkoutAttempts: invoice.checkoutAttempts },
      data: { checkoutAttempts: attempt, stripeCheckoutSessionId: session.id, stripeCheckoutUrl: session.url, stripeCheckoutExpiresAt: session.expiresAt, stripeCheckoutStatus: "open" },
    });
    await logActivity("payment.checkout_started", `Deposit checkout opened for ${order.number} (${formatCents(due)})`, { entityType: "invoice", entityId: invoice.id });
    if (!session.url) return { kind: "error", message: "Our payment provider didn't return a payment page. Please try again." };
    return { kind: "redirect", url: session.url };
  } catch (error) {
    logger.error("Stripe Checkout session creation failed", { error, invoiceId: invoice.id });
    return { kind: "error", message: "We couldn't start the secure payment page. Please try again in a moment, or contact us." };
  }
}

/**
 * Close the open deposit checkout before the deposit is settled another way
 * (manual payment) or the request is canceled (void), so the customer can't
 * also pay online. Refuses if the customer has just completed checkout — that
 * payment is confirmed by the webhook instead.
 */
export async function closeOpenCheckout(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { stripeCheckoutSessionId: true, stripeCheckoutStatus: true } });
  if (!invoice?.stripeCheckoutSessionId) return;
  if (invoice.stripeCheckoutStatus === "processing" || invoice.stripeCheckoutStatus === "complete") {
    throw new SalesError("The customer has already paid this online — wait for Stripe to confirm it (it appears under Payments) before recording anything else.");
  }
  if (invoice.stripeCheckoutStatus !== "open") return;
  const provider = getInvoicingProvider();
  if (!provider) return; // Stripe switched off: nothing can be paid through it now.
  let status: string;
  try {
    const current = await provider.retrieveCheckoutSession(invoice.stripeCheckoutSessionId);
    if (current.status === "complete") {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { stripeCheckoutStatus: current.paymentStatus === "paid" ? "complete" : "processing" } });
      throw new SalesError("The customer has just paid this online — wait for Stripe to confirm it (it appears under Payments) before recording anything else.");
    }
    if (current.status === "open") await provider.expireCheckoutSession(current.id);
    status = "expired";
  } catch (error) {
    if (error instanceof SalesError) throw error;
    logger.error("Could not close the open Stripe Checkout session", { error, invoiceId });
    throw new SalesError("Couldn't close the customer's open online payment page in Stripe. Please try again in a moment.");
  }
  await prisma.invoice.update({ where: { id: invoiceId }, data: { stripeCheckoutStatus: status } });
}

/**
 * Display-only refresh when Stripe returns the customer to the success page:
 * if the returned session is this order's current deposit session and Stripe
 * says it's complete, show "confirming" until the webhook records the
 * payment. Never records a payment — only the verified webhook does that.
 */
export async function noteCheckoutReturn(orderToken: string, sessionId: string | undefined) {
  if (!sessionId || !/^cs_[A-Za-z0-9_]{1,250}$/.test(sessionId)) return;
  const order = await prisma.order.findUnique({ where: { customerToken: orderToken }, select: { id: true } });
  const invoice = order ? await depositInvoiceFor(order.id) : null;
  if (!invoice || invoice.stripeCheckoutSessionId !== sessionId || invoice.stripeCheckoutStatus !== "open") return;
  const provider = getInvoicingProvider();
  if (!provider) return;
  try {
    const s = await provider.retrieveCheckoutSession(sessionId);
    if (s.status === "complete") {
      await prisma.invoice.updateMany({ where: { id: invoice.id, stripeCheckoutStatus: "open" }, data: { stripeCheckoutStatus: s.paymentStatus === "paid" ? "complete" : "processing" } });
    }
  } catch (error) {
    logger.warn("Could not check the returned Checkout session", { error, invoiceId: invoice.id });
  }
}
