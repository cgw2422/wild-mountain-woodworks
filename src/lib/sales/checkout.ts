import "server-only";
import type { Invoice } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { formatCents } from "@/lib/money";
import { getSettings, salesFlags } from "@/lib/settings";
import { siteUrl } from "@/lib/site-url";
import { SalesError } from "./errors";
import { BNPL_PAYMENT_METHOD_TYPES } from "@/lib/payments/messaging";
import { financingAmountFor, invoiceMoney } from "./ledger";
import { getInvoicingProvider } from "./stripe";

/**
 * Online payments through Stripe Checkout (payment mode), always against a
 * Wild Mountain Woodworks invoice. Every session has a purpose:
 *
 *  - DEPOSIT / FINAL_BALANCE — whatever the invoice says is due right now
 *    (the deposit, or the remaining balance once the admin marked it due).
 *    Affirm and Klarna are excluded: they never finance a deposit or a part.
 *  - FULL_PURCHASE_FINANCING — the customer chose to finance the whole
 *    order: the session is for the FULL invoice total (only while nothing has
 *    been paid), and Affirm/Klarna may appear when eligible.
 *
 * Amounts are computed on the server, never taken from the browser. One
 * session is kept per invoice: an open one for the same purpose and amount is
 * reused, anything else is expired and replaced, and the attempt counter is
 * part of the Stripe idempotency key so simultaneous clicks share a session.
 * Payment is only recorded from verified webhooks (payments.ts).
 */

export type CheckoutStart =
  | { kind: "redirect"; url: string }
  | { kind: "nothing_due" }
  | { kind: "processing" }
  | { kind: "offline" }
  | { kind: "financing_unavailable" }
  | { kind: "error"; message: string };

/** What a Checkout Session pays for (also its `payment_type` metadata). */
export type CheckoutPurpose = "DEPOSIT" | "FINAL_BALANCE" | "FULL_PURCHASE_FINANCING";

/** The stable "pay" link on the order (deposit right after acceptance, or the balance later). */
export function depositPayPath(orderToken: string) {
  return `/order/${orderToken}/pay`;
}

/** The stable "finance the full purchase" link on the order. */
export function orderFinancePath(orderToken: string) {
  return `/order/${orderToken}/finance`;
}

/** The stable "pay" link on the Wild Mountain Woodworks invoice page. */
export function invoicePayPath(invoiceToken: string) {
  return `/invoice/${invoiceToken}/pay`;
}

/** The stable "finance the full purchase" link on the invoice page. */
export function invoiceFinancePath(invoiceToken: string) {
  return `/invoice/${invoiceToken}/finance`;
}

/** Older name: the order's live deposit invoice (pre-unified orders) or its single invoice. */
export function depositInvoiceFor(orderId: string) {
  return prisma.invoice.findFirst({ where: { orderId, status: { notIn: ["VOIDED", "CANCELED", "DRAFT"] } }, orderBy: { createdAt: "asc" } });
}

/** Whether full-purchase financing is offered at all (online payments on + Settings → Payments → financing with Affirm and/or Klarna). */
export function financingOffered(settings: Awaited<ReturnType<typeof getSettings>>) {
  return salesFlags(settings).onlinePayments && settings.paymentFinancingMessaging && (settings.paymentAffirmMessaging || settings.paymentKlarnaMessaging);
}

async function liveOrderInvoices(orderToken: string) {
  const order = await prisma.order.findUnique({ where: { customerToken: orderToken }, select: { id: true, productionStatus: true } });
  if (!order || order.productionStatus === "CANCELED") return null;
  return prisma.invoice.findMany({ where: { orderId: order.id, status: { notIn: ["VOIDED", "CANCELED", "DRAFT"] } }, orderBy: { createdAt: "asc" } });
}

/** Pay whatever is due on an order (its first live invoice with an amount due). */
export async function startOrderCheckout(orderToken: string): Promise<CheckoutStart> {
  const invoices = await liveOrderInvoices(orderToken);
  if (!invoices) return { kind: "nothing_due" };
  const due = invoices.find((i) => invoiceMoney(i).dueNowCents > 0) ?? invoices.find((i) => ["complete", "processing"].includes(i.stripeCheckoutStatus ?? ""));
  if (!due) return { kind: "nothing_due" };
  return startInvoiceCheckout(due, "order", "due");
}

/** Older name kept for callers that pay the deposit right after acceptance. */
export const startDepositCheckout = startOrderCheckout;

/** Finance the order's full total (Affirm/Klarna when eligible). */
export async function startOrderFinancing(orderToken: string): Promise<CheckoutStart> {
  const invoices = await liveOrderInvoices(orderToken);
  const invoice = invoices?.find((i) => i.kind === "FULL");
  if (!invoice) return { kind: "financing_unavailable" };
  return startInvoiceCheckout(invoice, "order", "financing");
}

/** Pay whatever is due on one invoice, from its Wild Mountain Woodworks invoice page. */
export async function startInvoicePageCheckout(invoiceToken: string): Promise<CheckoutStart> {
  const invoice = await prisma.invoice.findUnique({ where: { publicToken: invoiceToken } });
  if (!invoice) return { kind: "nothing_due" };
  return startInvoiceCheckout(invoice, "invoice", "due");
}

/** Finance the full invoice total from the invoice page. */
export async function startInvoicePageFinancing(invoiceToken: string): Promise<CheckoutStart> {
  const invoice = await prisma.invoice.findUnique({ where: { publicToken: invoiceToken } });
  if (!invoice) return { kind: "financing_unavailable" };
  return startInvoiceCheckout(invoice, "invoice", "financing");
}

async function startInvoiceCheckout(invoice: Invoice, returnTo: "order" | "invoice", mode: "due" | "financing"): Promise<CheckoutStart> {
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

  const settings = await getSettings();
  let due: number;
  let purpose: CheckoutPurpose;
  if (mode === "financing") {
    // Only the whole order total, and only while nothing has been paid: never a deposit or a part.
    const full = financingAmountFor(invoice);
    if (!financingOffered(settings) || full == null) return { kind: "financing_unavailable" };
    due = full;
    purpose = "FULL_PURCHASE_FINANCING";
  } else {
    if (money.dueNowCents <= 0 || !money.dueNowType) return { kind: "nothing_due" };
    due = money.dueNowCents;
    purpose = money.dueNowType;
  }

  const provider = getInvoicingProvider();
  if (!salesFlags(settings).onlinePayments || !provider) return { kind: "offline" };

  // An older invoice already sent through Stripe Invoicing is paid on its hosted page, never twice.
  if (invoice.stripeHostedInvoiceUrl && invoice.stripeStatus !== "void") return mode === "financing" ? { kind: "financing_unavailable" } : { kind: "redirect", url: invoice.stripeHostedInvoiceUrl };

  // Reuse the current session while it's open and still for the same purpose and amount.
  if (invoice.stripeCheckoutSessionId && ["open", null].includes(invoice.stripeCheckoutStatus)) {
    try {
      const current = await provider.retrieveCheckoutSession(invoice.stripeCheckoutSessionId);
      if (current.status === "complete") {
        await prisma.invoice.update({ where: { id: invoice.id }, data: { stripeCheckoutStatus: current.paymentStatus === "paid" ? "complete" : "processing" } });
        return { kind: "processing" };
      }
      const samePurpose = (invoice.stripeCheckoutPurpose ?? (mode === "due" ? purpose : null)) === purpose;
      if (current.status === "open" && current.url && samePurpose && current.amountTotal === due && (!current.expiresAt || current.expiresAt.getTime() > Date.now() + 60_000)) {
        return { kind: "redirect", url: current.url };
      }
      // Switching between deposit and financing (or a changed amount): the old page can't be paid any more.
      if (current.status === "open") await provider.expireCheckoutSession(current.id).catch(() => undefined);
    } catch (error) {
      logger.error("Could not check the Stripe Checkout session", { error, invoiceId: invoice.id });
      return { kind: "error", message: "We couldn't reach our payment provider. Please try again in a moment." };
    }
  }

  const attempt = invoice.checkoutAttempts + 1;
  const what = purpose === "DEPOSIT" ? "Deposit" : purpose === "FINAL_BALANCE" ? "Remaining balance" : "Full purchase";
  const ref = order ? `order ${order.number}` : `invoice ${invoice.number}`;
  const metadata = {
    payment_type: purpose,
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
      idempotencyKey: `wm-pay-${invoice.id}-${attempt}-${purpose}-${due}`,
      amountCents: due,
      productName: `${what} — ${ref}`,
      description: `${what} for Wild Mountain Woodworks ${ref} (invoice ${invoice.number})`,
      customerEmail: invoice.customerEmail,
      clientReferenceId: invoice.id,
      successUrl: siteUrl(`${back}/payment-success?session_id={CHECKOUT_SESSION_ID}`),
      cancelUrl: siteUrl(`${back}?payment=canceled`),
      metadata,
      // Affirm/Klarna only ever finance the whole order.
      excludedPaymentMethodTypes: purpose === "FULL_PURCHASE_FINANCING" ? [] : BNPL_PAYMENT_METHOD_TYPES,
    });
    // Only the first of two simultaneous requests bumps the counter; both got the same session.
    await prisma.invoice.updateMany({
      where: { id: invoice.id, checkoutAttempts: invoice.checkoutAttempts },
      data: { checkoutAttempts: attempt, stripeCheckoutSessionId: session.id, stripeCheckoutUrl: session.url, stripeCheckoutExpiresAt: session.expiresAt, stripeCheckoutStatus: "open", stripeCheckoutPurpose: purpose },
    });
    await logActivity("payment.checkout_started", `${what} checkout opened for ${ref} (${formatCents(due)}, invoice ${invoice.number})${purpose === "FULL_PURCHASE_FINANCING" ? " — full-purchase financing" : ""}`, { entityType: "invoice", entityId: invoice.id });
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
