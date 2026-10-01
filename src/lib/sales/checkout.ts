import "server-only";
import type { Invoice } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { formatCents } from "@/lib/money";
import { getSettings, salesFlags } from "@/lib/settings";
import { siteUrl } from "@/lib/site-url";
import { SalesError } from "./errors";
import { invoiceMoney } from "./ledger";
import { getInvoicingProvider } from "./stripe";

/**
 * Online payments through Stripe Checkout (payment mode), always against a
 * Wild Mountain invoice. The amount is whatever the invoice says is due right
 * now — the deposit, or the remaining balance once the admin marked it due —
 * computed on the server, never taken from the browser. One session is kept
 * per invoice: an open one for the right amount is reused, a stale or
 * expired one is replaced, and the attempt counter is part of the Stripe
 * idempotency key so simultaneous clicks share a session. Payment is only
 * recorded from verified webhooks (payments.ts), never from the redirect.
 */

export type CheckoutStart =
  | { kind: "redirect"; url: string }
  | { kind: "nothing_due" }
  | { kind: "processing" }
  | { kind: "offline" }
  | { kind: "error"; message: string };

/** The stable "pay" link on the order (deposit right after acceptance, or the balance later). */
export function depositPayPath(orderToken: string) {
  return `/order/${orderToken}/pay`;
}

/** The stable "pay" link on the Wild Mountain invoice page. */
export function invoicePayPath(invoiceToken: string) {
  return `/invoice/${invoiceToken}/pay`;
}

/** Older name: the order's live deposit invoice (pre-unified orders) or its single invoice. */
export function depositInvoiceFor(orderId: string) {
  return prisma.invoice.findFirst({ where: { orderId, status: { notIn: ["VOIDED", "CANCELED", "DRAFT"] } }, orderBy: { createdAt: "asc" } });
}

/** Pay whatever is due on an order (its first live invoice with an amount due). */
export async function startOrderCheckout(orderToken: string): Promise<CheckoutStart> {
  const order = await prisma.order.findUnique({ where: { customerToken: orderToken }, select: { id: true, productionStatus: true } });
  if (!order || order.productionStatus === "CANCELED") return { kind: "nothing_due" };
  const invoices = await prisma.invoice.findMany({ where: { orderId: order.id, status: { notIn: ["VOIDED", "CANCELED", "DRAFT"] } }, orderBy: { createdAt: "asc" } });
  const due = invoices.find((i) => invoiceMoney(i).dueNowCents > 0) ?? invoices.find((i) => ["complete", "processing"].includes(i.stripeCheckoutStatus ?? ""));
  if (!due) return { kind: "nothing_due" };
  return startInvoiceCheckout(due, "order");
}

/** Older name kept for callers that pay the deposit right after acceptance. */
export const startDepositCheckout = startOrderCheckout;

/** Pay whatever is due on one invoice, from its Wild Mountain invoice page. */
export async function startInvoicePageCheckout(invoiceToken: string): Promise<CheckoutStart> {
  const invoice = await prisma.invoice.findUnique({ where: { publicToken: invoiceToken } });
  if (!invoice) return { kind: "nothing_due" };
  return startInvoiceCheckout(invoice, "invoice");
}

async function startInvoiceCheckout(invoice: Invoice, returnTo: "order" | "invoice"): Promise<CheckoutStart> {
  const order = invoice.orderId
    ? await prisma.order.findUnique({ where: { id: invoice.orderId }, include: { quote: { select: { id: true, number: true, status: true } }, acceptedRevision: { select: { number: true } } } })
    : null;
  if (["VOIDED", "CANCELED", "DRAFT"].includes(invoice.status) || order?.productionStatus === "CANCELED" || order?.quote?.status === "VOIDED") return { kind: "nothing_due" };
  const money = invoiceMoney(invoice);
  // A session the customer finished but Stripe hasn't confirmed to us yet (once recorded, it's history).
  const unconfirmed = Boolean(
    invoice.stripeCheckoutSessionId &&
      ["complete", "processing"].includes(invoice.stripeCheckoutStatus ?? "") &&
      !(await prisma.payment.findFirst({ where: { stripeCheckoutSessionId: invoice.stripeCheckoutSessionId }, select: { id: true } })),
  );
  if (unconfirmed) return { kind: "processing" };
  if (money.dueNowCents <= 0 || !money.dueNowType) return { kind: "nothing_due" };
  const due = money.dueNowCents;
  const paymentType = money.dueNowType;

  const flags = salesFlags(await getSettings());
  const provider = getInvoicingProvider();
  if (!flags.onlinePayments || !provider) return { kind: "offline" };

  // An older invoice already sent through Stripe Invoicing is paid on its hosted page, never twice.
  if (invoice.stripeHostedInvoiceUrl && invoice.stripeStatus !== "void") return { kind: "redirect", url: invoice.stripeHostedInvoiceUrl };

  // Reuse the current session while it's open and still for the right amount.
  if (invoice.stripeCheckoutSessionId && ["open", null].includes(invoice.stripeCheckoutStatus)) {
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
  const what = paymentType === "DEPOSIT" ? "Deposit" : "Remaining balance";
  const ref = order ? `order ${order.number}` : `invoice ${invoice.number}`;
  const metadata = {
    payment_type: paymentType,
    expected_amount: String(due),
    invoice_id: invoice.id,
    invoice_number: invoice.number,
    order_id: order?.id ?? "",
    order_number: order?.number ?? "",
    quote_id: order?.quote?.id ?? "",
    quote_number: order?.quote?.number ?? "",
    quote_revision: String(order?.acceptedRevision?.number ?? ""),
    customer_id: invoice.customerId ?? "",
  };
  const back = returnTo === "order" && order?.customerToken ? `/order/${order.customerToken}` : `/invoice/${invoice.publicToken}`;
  try {
    const session = await provider.createCheckoutSession({
      idempotencyKey: `wm-pay-${invoice.id}-${attempt}-${paymentType}-${due}`,
      amountCents: due,
      productName: `${what} — ${ref}`,
      description: `${what} for Wild Mountain Woodworks ${ref} (invoice ${invoice.number})`,
      customerEmail: invoice.customerEmail,
      clientReferenceId: invoice.id,
      successUrl: siteUrl(`${back}/payment-success?session_id={CHECKOUT_SESSION_ID}`),
      cancelUrl: siteUrl(`${back}?payment=canceled`),
      metadata,
    });
    // Only the first of two simultaneous requests bumps the counter; both got the same session.
    await prisma.invoice.updateMany({
      where: { id: invoice.id, checkoutAttempts: invoice.checkoutAttempts },
      data: { checkoutAttempts: attempt, stripeCheckoutSessionId: session.id, stripeCheckoutUrl: session.url, stripeCheckoutExpiresAt: session.expiresAt, stripeCheckoutStatus: "open" },
    });
    await logActivity("payment.checkout_started", `${what} checkout opened for ${ref} (${formatCents(due)}, invoice ${invoice.number})`, { entityType: "invoice", entityId: invoice.id });
    if (!session.url) return { kind: "error", message: "Our payment provider didn't return a payment page. Please try again." };
    return { kind: "redirect", url: session.url };
  } catch (error) {
    logger.error("Stripe Checkout session creation failed", { error, invoiceId: invoice.id });
    return { kind: "error", message: "We couldn't start the secure payment page. Please try again in a moment, or contact us." };
  }
}

/**
 * Close the open checkout before the amount is settled another way (manual
 * or Terminal payment), the balance changes, or the invoice is voided, so the
 * customer can't also pay online. Refuses if the customer has just completed
 * checkout — that payment is confirmed by the webhook instead.
 */
export async function closeOpenCheckout(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { stripeCheckoutSessionId: true, stripeCheckoutStatus: true } });
  if (!invoice?.stripeCheckoutSessionId) return;
  if (invoice.stripeCheckoutStatus === "processing" || invoice.stripeCheckoutStatus === "complete") {
    // A completed session that has since been recorded is no obstacle.
    const recorded = await prisma.payment.findFirst({ where: { stripeCheckoutSessionId: invoice.stripeCheckoutSessionId }, select: { id: true } });
    if (recorded) return;
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
 * Display-only refresh when Stripe returns the customer: if the returned
 * session is the current session of an invoice on this order (or this
 * invoice) and Stripe says it's complete, show "confirming" until the webhook
 * records the payment. Never records a payment — only the verified webhook does.
 */
export async function noteCheckoutReturn(scope: { orderToken?: string; invoiceToken?: string } | string, sessionId: string | undefined) {
  if (!sessionId || !/^cs_[A-Za-z0-9_]{1,250}$/.test(sessionId)) return;
  const s = typeof scope === "string" ? { orderToken: scope } : scope;
  const invoice = await prisma.invoice.findFirst({
    where: {
      stripeCheckoutSessionId: sessionId,
      stripeCheckoutStatus: "open",
      ...(s.invoiceToken ? { publicToken: s.invoiceToken } : s.orderToken ? { order: { is: { customerToken: s.orderToken } } } : { id: "-" }),
    },
  });
  if (!invoice) return;
  const provider = getInvoicingProvider();
  if (!provider) return;
  try {
    const session = await provider.retrieveCheckoutSession(sessionId);
    if (session.status === "complete") {
      await prisma.invoice.updateMany({ where: { id: invoice.id, stripeCheckoutStatus: "open" }, data: { stripeCheckoutStatus: session.paymentStatus === "paid" ? "complete" : "processing" } });
    }
  } catch (error) {
    logger.warn("Could not check the returned Checkout session", { error, invoiceId: invoice.id });
  }
}
