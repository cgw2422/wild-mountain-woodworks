import "server-only";
import { prisma } from "@/lib/db";
import { getSettings, salesFlags } from "@/lib/settings";
import { paymentMessaging } from "@/lib/payments/messaging";
import { financingOffered } from "./checkout";
import { stripePublishableKey } from "./stripe";
import { acceptBlocker, customerRevisionOf, depositLabel, expireDueQuotes } from "./quotes";
import type { InvoiceStatus } from "@/generated/prisma/client";
import { financingAmountFor, invoiceMoney, netPaid, pendingAmount } from "./ledger";
import { PAYMENT_TYPE_LABELS, PRODUCTION_STATUS_LABELS, deliveryMethodLabel, isFinancingMethod, stripeMethodName, type PaymentTypeValue, type ProductionStatusValue } from "./status";
import { isTokenShape } from "./tokens";
import type { LineKind } from "./totals";

/**
 * Customer-safe views for /quote/[token], /invoice/[token] and
 * /order/[token]. These builders are the ONLY data those pages receive: an
 * explicit allow-list of fields — no database ids, internal notes, costs,
 * estimates, staff names, production notes or other customers' data.
 */

export interface CustomerLine {
  kind: LineKind;
  description: string;
  notes: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface CustomerTotals {
  subtotalCents: number;
  discountCents: number;
  deliveryCents: number;
  otherChargesCents: number;
  taxCents: number;
  totalCents: number;
}

function lines(rows: Array<CustomerLine & { position: number }>): CustomerLine[] {
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((l) => ({ kind: l.kind, description: l.description, notes: l.notes, quantity: l.quantity, unitPriceCents: l.unitPriceCents, lineTotalCents: l.lineTotalCents }));
}

async function business() {
  const s = await getSettings();
  return { name: s.businessName, email: s.email, phone: s.phone };
}

export type QuoteView = NonNullable<Awaited<ReturnType<typeof loadCustomerQuote>>>["view"];

/**
 * `view` is safe to render or pass to client components. `internal` holds
 * the ids the server needs to record the view — never send it to the browser.
 */
export async function loadCustomerQuote(token: string) {
  if (!isTokenShape(token)) return null;
  const found = await prisma.quoteRequest.findUnique({ where: { customerToken: token }, select: { id: true, status: true } });
  if (!found) return null;
  if (found.status === "SENT" || found.status === "VIEWED") await expireDueQuotes();
  const quote = await prisma.quoteRequest.findUnique({
    where: { customerToken: token },
    include: {
      revisions: { include: { lineItems: true } },
      orders: { select: { customerToken: true, number: true }, take: 1, orderBy: { createdAt: "asc" } },
      invoices: { where: { status: { not: "DRAFT" } }, select: { number: true, kind: true, status: true, totalCents: true, amountPaidCents: true, publicToken: true, stripeHostedInvoiceUrl: true }, orderBy: { createdAt: "asc" } },
      files: { where: { customerVisible: true }, include: { media: { select: { url: true, originalName: true, mimeType: true } } } },
    },
  });
  if (!quote || quote.archivedAt) return null;
  const rev = customerRevisionOf(quote.revisions);
  const [biz, settings] = await Promise.all([business(), getSettings()]);
  const stripe = salesFlags(settings).stripeInvoicing;
  const view = {
    business: biz,
    number: quote.number ?? quote.reference,
    status: quote.status,
    ready: Boolean(rev),
    revision: rev
      ? {
          number: rev.number,
          status: rev.status,
          sentAt: rev.sentAt,
          expiresAt: rev.expiresAt,
          customer: { name: rev.customerName, email: rev.customerEmail, phone: rev.customerPhone, address: rev.customerAddress },
          lines: lines(rev.lineItems as Array<CustomerLine & { position: number }>),
          totals: { subtotalCents: rev.subtotalCents, discountCents: rev.discountCents, deliveryCents: rev.deliveryCents, otherChargesCents: rev.otherChargesCents, taxCents: rev.taxCents, totalCents: rev.totalCents } satisfies CustomerTotals,
          depositCents: rev.depositCents,
          balanceCents: rev.balanceCents,
          depositLabel: depositLabel(rev),
          terms: rev.terms,
          customerNotes: rev.customerNotes,
          leadTime: rev.leadTime,
          estimatedCompletion: rev.estimatedCompletion,
          deliveryDetails: rev.deliveryDetails,
          acceptedAt: rev.acceptedAt,
          acceptedName: rev.acceptedName,
          declinedAt: rev.declinedAt,
        }
      : null,
    blocker: acceptBlocker(quote, rev),
    /** Voided quotes stay viewable for the customer's records but can't be accepted or paid. */
    voided: quote.status === "VOIDED",
    /** Whether accepting continues straight to the secure online deposit payment. */
    onlinePayments: stripe,
    /** Settings → Payments wording (financing / methods); empty when online payments are off. */
    paymentMessaging: paymentMessaging(settings, stripe),
    /** Offer "Finance full purchase" (Affirm/Klarna when eligible) next to the deposit. */
    financingAvailable: financingOffered(settings),
    /** Public Stripe key for Stripe's own Affirm/Klarna eligibility messaging (optional). */
    stripePublishableKey: stripe ? stripePublishableKey() : null,
    order: quote.orders[0]?.customerToken ? { number: quote.orders[0].number, token: quote.orders[0].customerToken } : null,
    invoices: quote.invoices.map((i) => ({
      number: i.number,
      kind: i.kind,
      status: i.status,
      amountDueCents: Math.max(0, i.totalCents - i.amountPaidCents),
      totalCents: i.totalCents,
      href: i.publicToken ? `/invoice/${i.publicToken}` : null,
      payUrl: !stripe || ["PAID", "VOIDED", "CANCELED"].includes(i.status) || i.totalCents - i.amountPaidCents <= 0 ? null : quote.orders[0]?.customerToken ? `/order/${quote.orders[0].customerToken}/pay` : i.publicToken ? `/invoice/${i.publicToken}/pay` : null,
    })),
    files: quote.files.map((f) => ({ url: f.media.url, name: f.label || f.media.originalName, mimeType: f.media.mimeType })),
  };
  return { view, internal: { quoteId: quote.id, revisionId: rev?.id ?? null, revisionStatus: rev?.status ?? null } };
}

/* ------------------------------------------------------------ invoices & orders */

type PaymentRow = { amountCents: number; refundedCents: number; status: string; method: string; type: string; receivedAt: Date; stripeCheckoutSessionId: string | null; stripePaymentMethodType: string | null };

/** Customer-safe payment history: what was received (and what's pending) — no references, notes or ids. */
function customerPayments(payments: PaymentRow[]) {
  return [...payments]
    .filter((p) => netPaid(p) > 0 || p.refundedCents > 0 || p.status === "PENDING")
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
    .map((p) => ({
      receivedAt: p.receivedAt,
      label: PAYMENT_TYPE_LABELS[p.type as PaymentTypeValue] ?? "Payment",
      method:
        p.method === "STRIPE_ONLINE"
          ? (stripeMethodName(p.stripePaymentMethodType) ?? "Card / online")
          : p.method === "STRIPE_TERMINAL"
            ? "Card (in person)"
            : p.method === "CHECK"
              ? "Check"
              : p.method === "CASH"
                ? "Cash"
                : p.method === "BANK_TRANSFER"
                  ? "Bank transfer"
                  : "Other",
      amountCents: p.amountCents,
      refundedCents: p.refundedCents,
      pending: p.status === "PENDING",
    }));
}

type InvoiceRow = {
  number: string;
  kind: string;
  status: InvoiceStatus;
  totalCents: number;
  depositCents: number;
  amountPaidCents: number;
  pendingCents: number;
  balanceDueAt: Date | null;
  publicToken: string | null;
  stripeHostedInvoiceUrl: string | null;
  stripeStatus: string | null;
  stripeCheckoutSessionId: string | null;
  stripeCheckoutStatus: string | null;
  payments: PaymentRow[];
};

/** Money summary + what the customer can do right now on one invoice. */
function invoiceSummary(i: InvoiceRow, online: boolean, payHref: string | null, financeHref: string | null = null) {
  const money = invoiceMoney(i);
  const closed = i.status === "VOIDED" || i.status === "CANCELED";
  const recorded = i.stripeCheckoutSessionId ? i.payments.some((p) => p.stripeCheckoutSessionId === i.stripeCheckoutSessionId) : true;
  const confirming = !closed && !recorded && ["complete", "processing"].includes(i.stripeCheckoutStatus ?? "");
  const financeAmount = financingAmountFor(i);
  // Paid in one full-purchase payment (e.g. financed with Affirm/Klarna): the provider handles repayments.
  const fullPurchase = money.remainingCents <= 0 ? i.payments.find((p) => p.type === "FULL_PURCHASE" && netPaid(p) > 0) : undefined;
  return {
    number: i.number,
    kind: i.kind,
    status: i.status,
    voided: closed,
    totalCents: i.totalCents,
    depositCents: i.depositCents,
    paidCents: money.paidCents,
    pendingCents: money.pendingCents,
    remainingCents: closed ? 0 : money.remainingCents,
    dueNowCents: closed ? 0 : money.dueNowCents,
    dueNowType: closed ? null : money.dueNowType,
    balanceRequested: Boolean(i.balanceDueAt),
    /** Stripe has the customer's payment and is confirming it (webhook not in yet). */
    confirming,
    href: i.publicToken ? `/invoice/${i.publicToken}` : null,
    payHref: !closed && online && money.dueNowCents > 0 ? payHref : null,
    /** "Finance full purchase": the WHOLE total, only while nothing is paid (never the deposit). */
    financing: !closed && !confirming && financeHref && financeAmount != null ? { amountCents: financeAmount, href: financeHref } : null,
    /** "Paid with Affirm" — only when Stripe reported the method of a full-purchase payment. */
    paidInFullWith: fullPurchase ? stripeMethodName(fullPurchase.stripePaymentMethodType) : null,
    paidInFullFinanced: Boolean(fullPurchase && isFinancingMethod(fullPurchase.stripePaymentMethodType)),
  };
}

export type InvoiceView = NonNullable<Awaited<ReturnType<typeof customerInvoiceView>>>;

/**
 * The customer's main financial page (/invoice/[token]): one invoice for the
 * order, its payments, the remaining balance and — when something is due —
 * a button to pay it securely through Stripe.
 */
export async function customerInvoiceView(token: string) {
  if (!isTokenShape(token)) return null;
  const invoice = await prisma.invoice.findUnique({
    where: { publicToken: token },
    include: {
      lineItems: true,
      order: { select: { number: true, customerToken: true, productionStatus: true, paymentStatus: true, deliveryAddress: true, deliveryDate: true, deliveryWindow: true, deliveryMethod: true, deliveryNotes: true, estimatedCompletion: true } },
      quote: { select: { number: true } },
      revision: { select: { terms: true } },
      payments: true,
    },
  });
  if (!invoice || invoice.status === "DRAFT") return null;
  const [biz, settings] = await Promise.all([business(), getSettings()]);
  const online = salesFlags(settings).onlinePayments;
  const summary = invoiceSummary(invoice, online, `/invoice/${token}/pay`, financingOffered(settings) ? `/invoice/${token}/finance` : null);
  const order = invoice.order;
  return {
    business: biz,
    ...summary,
    issuedAt: invoice.sentAt ?? invoice.createdAt,
    paidAt: invoice.paidAt,
    customer: { name: invoice.customerName, email: invoice.customerEmail },
    orderNumber: order?.number ?? null,
    orderHref: order?.customerToken ? `/order/${order.customerToken}` : null,
    quoteNumber: invoice.quote?.number ?? null,
    productionStatus: order?.productionStatus ?? null,
    orderPaymentStatus: order?.paymentStatus ?? null,
    delivery: order
      ? { address: order.deliveryAddress, date: order.deliveryDate, window: order.deliveryWindow, method: deliveryMethodLabel(order.deliveryMethod), notes: order.deliveryNotes, estimatedCompletion: order.estimatedCompletion }
      : null,
    lines: lines(invoice.lineItems as Array<CustomerLine & { position: number }>),
    totals: { subtotalCents: invoice.subtotalCents, discountCents: invoice.discountCents, deliveryCents: invoice.deliveryCents, otherChargesCents: invoice.otherChargesCents, taxCents: invoice.taxCents, totalCents: invoice.totalCents } satisfies CustomerTotals,
    customerNotes: invoice.customerNotes,
    terms: invoice.revision?.terms ?? null,
    payments: customerPayments(invoice.payments),
    recentlyPaid: invoice.payments.some((p) => netPaid(p) > 0 && Date.now() - p.receivedAt.getTime() < 30 * 60_000),
    paymentInstructions: !summary.voided && !online && summary.remainingCents > 0 ? settings.paymentInstructions : null,
    paymentMessaging: paymentMessaging(settings, online),
    stripePublishableKey: online ? stripePublishableKey() : null,
    /** Older invoices sent through Stripe Invoicing keep their PDF. */
    pdfUrl: online && invoice.stripeInvoicePdfUrl ? invoice.stripeInvoicePdfUrl : null,
  };
}

export type OrderView = NonNullable<Awaited<ReturnType<typeof customerOrderView>>>;

/** A customer-facing milestone on the order timeline. */
export interface Milestone {
  at: Date;
  kind: "production" | "payment" | "order";
  label: string;
}

/**
 * The customer's order page (/order/[token]): current stage, payment state,
 * the invoice money summary, payment history, delivery details and recent
 * milestones. No shop notes, costs, margins or internal comments.
 */
export async function customerOrderView(token: string) {
  if (!isTokenShape(token)) return null;
  const order = await prisma.order.findUnique({
    where: { customerToken: token },
    include: {
      items: true,
      payments: true,
      quote: { select: { number: true, customerToken: true } },
      acceptedRevision: { select: { acceptedAt: true } },
      invoices: { where: { status: { not: "DRAFT" } }, orderBy: { createdAt: "asc" }, include: { payments: true } },
      statusEvents: { orderBy: { createdAt: "asc" }, select: { id: true, toStatus: true, createdAt: true } },
      files: { where: { customerVisible: true }, include: { media: { select: { url: true, originalName: true, mimeType: true } } } },
    },
  });
  if (!order) return null;
  const [biz, settings] = await Promise.all([business(), getSettings()]);
  const online = salesFlags(settings).onlinePayments;
  const paid = order.payments.reduce((s, p) => s + netPaid(p), 0);
  const pending = order.payments.reduce((s, p) => s + pendingAmount(p), 0);
  const invoices = order.invoices.map((i) => invoiceSummary(i, online, `/order/${token}/pay`, financingOffered(settings) ? `/order/${token}/finance` : null));
  const live = invoices.filter((i) => !i.voided);
  const due = live.find((i) => i.dueNowCents > 0) ?? null;
  const confirming = live.some((i) => i.confirming);
  const canceled = order.productionStatus === "CANCELED";
  const depositOwed = due?.dueNowType === "DEPOSIT" ? due.dueNowCents : 0;
  // Older orders have a separate deposit invoice; newer ones carry the deposit on their one invoice.
  const deposit =
    order.depositCents > 0
      ? {
          amountCents: order.depositCents,
          dueCents: canceled ? 0 : depositOwed,
          paid: paid >= order.depositCents,
          confirming: confirming && paid < order.depositCents,
          payHref: !canceled && depositOwed > 0 && online ? `/order/${token}/pay` : null,
          instructions: !canceled && depositOwed > 0 && !online ? settings.paymentInstructions : null,
        }
      : null;

  const milestones: Milestone[] = [];
  if (order.acceptedRevision?.acceptedAt) milestones.push({ at: order.acceptedRevision.acceptedAt, kind: "order", label: "Quote accepted" });
  for (const e of order.statusEvents) {
    if (e.id.startsWith("mig_") || e.toStatus.startsWith("payment:") || e.toStatus.startsWith("delivery:") || e.toStatus === "AWAITING_DEPOSIT") continue;
    const label = PRODUCTION_STATUS_LABELS[e.toStatus as ProductionStatusValue];
    if (label) milestones.push({ at: e.createdAt, kind: "production", label });
  }
  for (const p of order.payments) {
    if (netPaid(p) <= 0) continue;
    milestones.push({ at: p.receivedAt, kind: "payment", label: p.type === "DEPOSIT" ? "Deposit received" : p.type === "FINAL_BALANCE" ? "Final payment received" : p.type === "FULL_PURCHASE" ? "Paid in full" : "Payment received" });
  }
  for (const i of order.invoices) if (i.balanceDueAt && i.status !== "VOIDED") milestones.push({ at: i.balanceDueAt, kind: "payment", label: "Final balance requested" });
  milestones.sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    business: biz,
    deposit,
    paymentMessaging: paymentMessaging(settings, online),
    stripePublishableKey: online ? stripePublishableKey() : null,
    number: order.number,
    placedAt: order.createdAt,
    productionStatus: order.productionStatus,
    paymentStatus: order.paymentStatus,
    canceled,
    delivery: { address: order.deliveryAddress, date: order.deliveryDate, window: order.deliveryWindow, method: deliveryMethodLabel(order.deliveryMethod), notes: order.deliveryNotes },
    deliveryDate: order.deliveryDate,
    deliveryNotes: order.deliveryNotes,
    estimatedCompletion: order.estimatedCompletion,
    customerNotes: order.customerNotes,
    customer: { name: order.customerName, address: order.deliveryAddress },
    quote: order.quote?.customerToken ? { number: order.quote.number, href: `/quote/${order.quote.customerToken}` } : null,
    items: [...order.items].sort((a, b) => a.position - b.position).map((i) => ({ kind: i.kind, description: i.description ?? i.productName, notes: i.notes, quantity: i.quantity, lineTotalCents: i.lineTotalCents })),
    totalCents: order.totalCents,
    depositCents: order.depositCents,
    paidCents: paid,
    pendingCents: pending,
    balanceCents: Math.max(0, order.totalCents - paid),
    /** "Finance full purchase" for the whole order total, while nothing has been paid. */
    financing: !canceled ? (live.find((i) => i.financing)?.financing ?? null) : null,
    paidInFullWith: live.find((i) => i.paidInFullWith)?.paidInFullWith ?? null,
    paidInFullFinanced: live.some((i) => i.paidInFullFinanced),
    /** What can be paid online right now (deposit or balance), if anything. */
    due: !canceled && due ? { amountCents: due.dueNowCents, type: due.dueNowType, invoiceNumber: due.number, payHref: due.payHref, invoiceHref: due.href } : null,
    confirming,
    paymentInstructions: !canceled && !online && Math.max(0, order.totalCents - paid) > 0 ? settings.paymentInstructions : null,
    invoices: invoices.map(({ number, kind, status, voided, totalCents, paidCents, remainingCents, href, payHref }) => ({ number, kind, status, voided, totalCents, amountDueCents: remainingCents, paidCents, href, payUrl: payHref })),
    payments: customerPayments(order.payments),
    /** A payment settled in the last half hour (for the "thank you" page after Stripe returns). */
    recentlyPaid: order.payments.some((p) => netPaid(p) > 0 && Date.now() - p.receivedAt.getTime() < 30 * 60_000),
    milestones,
    files: order.files.map((f) => ({ url: f.media.url, name: f.label || f.media.originalName, mimeType: f.media.mimeType })),
  };
}
