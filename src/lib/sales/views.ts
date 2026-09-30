import "server-only";
import { prisma } from "@/lib/db";
import { getSettings, salesFlags } from "@/lib/settings";
import { acceptBlocker, customerRevisionOf, depositLabel, expireDueQuotes } from "./quotes";
import { netPaid } from "./ledger";
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
      invoices: { where: { status: { notIn: ["DRAFT", "VOID", "CANCELED"] } }, select: { number: true, kind: true, status: true, totalCents: true, amountPaidCents: true, publicToken: true, stripeHostedInvoiceUrl: true }, orderBy: { createdAt: "asc" } },
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
    order: quote.orders[0]?.customerToken ? { number: quote.orders[0].number, token: quote.orders[0].customerToken } : null,
    invoices: quote.invoices.map((i) => ({
      number: i.number,
      kind: i.kind,
      status: i.status,
      amountDueCents: Math.max(0, i.totalCents - i.amountPaidCents),
      totalCents: i.totalCents,
      href: i.publicToken ? `/invoice/${i.publicToken}` : null,
      payUrl: stripe && i.stripeHostedInvoiceUrl ? i.stripeHostedInvoiceUrl : null,
    })),
    files: quote.files.map((f) => ({ url: f.media.url, name: f.label || f.media.originalName, mimeType: f.media.mimeType })),
  };
  return { view, internal: { quoteId: quote.id, revisionId: rev?.id ?? null, revisionStatus: rev?.status ?? null } };
}

export type InvoiceView = NonNullable<Awaited<ReturnType<typeof customerInvoiceView>>>;

export async function customerInvoiceView(token: string) {
  if (!isTokenShape(token)) return null;
  const invoice = await prisma.invoice.findUnique({
    where: { publicToken: token },
    include: { lineItems: true, order: { select: { number: true, customerToken: true } }, quote: { select: { number: true } }, payments: true },
  });
  if (!invoice || invoice.status === "DRAFT") return null;
  const [biz, settings] = await Promise.all([business(), getSettings()]);
  const stripe = salesFlags(settings).stripeInvoicing;
  const open = !["PAID", "VOID", "CANCELED"].includes(invoice.status);
  return {
    business: biz,
    number: invoice.number,
    kind: invoice.kind,
    status: invoice.status,
    issuedAt: invoice.sentAt ?? invoice.createdAt,
    dueDate: invoice.dueDate,
    paidAt: invoice.paidAt,
    customer: { name: invoice.customerName, email: invoice.customerEmail },
    orderNumber: invoice.order?.number ?? null,
    orderHref: invoice.order?.customerToken ? `/order/${invoice.order.customerToken}` : null,
    quoteNumber: invoice.quote?.number ?? null,
    lines: lines(invoice.lineItems as Array<CustomerLine & { position: number }>),
    totals: { subtotalCents: invoice.subtotalCents, discountCents: invoice.discountCents, deliveryCents: invoice.deliveryCents, otherChargesCents: invoice.otherChargesCents, taxCents: invoice.taxCents, totalCents: invoice.totalCents } satisfies CustomerTotals,
    amountPaidCents: invoice.amountPaidCents,
    amountDueCents: Math.max(0, invoice.totalCents - invoice.amountPaidCents),
    customerNotes: invoice.customerNotes,
    payUrl: open && stripe && invoice.stripeHostedInvoiceUrl ? invoice.stripeHostedInvoiceUrl : null,
    pdfUrl: stripe && invoice.stripeInvoicePdfUrl ? invoice.stripeInvoicePdfUrl : null,
    paymentInstructions: open && !(stripe && invoice.stripeHostedInvoiceUrl) ? settings.paymentInstructions : null,
    payments: invoice.payments
      .filter((p) => netPaid(p) > 0 || p.refundedCents > 0)
      .map((p) => ({ amountCents: p.amountCents, refundedCents: p.refundedCents, method: p.method, receivedAt: p.receivedAt })),
    voided: invoice.status === "VOID" || invoice.status === "CANCELED",
  };
}

export type OrderView = NonNullable<Awaited<ReturnType<typeof customerOrderView>>>;

export async function customerOrderView(token: string) {
  if (!isTokenShape(token)) return null;
  const order = await prisma.order.findUnique({
    where: { customerToken: token },
    include: {
      items: true,
      payments: true,
      quote: { select: { number: true, customerToken: true } },
      invoices: { where: { status: { notIn: ["DRAFT"] } }, orderBy: { createdAt: "asc" } },
      files: { where: { customerVisible: true }, include: { media: { select: { url: true, originalName: true, mimeType: true } } } },
    },
  });
  if (!order) return null;
  const [biz, settings] = await Promise.all([business(), getSettings()]);
  const stripe = salesFlags(settings).stripeInvoicing;
  const paid = order.payments.reduce((s, p) => s + netPaid(p), 0);
  return {
    business: biz,
    number: order.number,
    placedAt: order.createdAt,
    productionStatus: order.productionStatus,
    paymentStatus: order.paymentStatus,
    deliveryStatus: order.deliveryStatus,
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
    balanceCents: Math.max(0, order.totalCents - paid),
    invoices: order.invoices.map((i) => ({
      number: i.number,
      kind: i.kind,
      status: i.status,
      totalCents: i.totalCents,
      amountDueCents: Math.max(0, i.totalCents - i.amountPaidCents),
      href: i.publicToken ? `/invoice/${i.publicToken}` : null,
      payUrl: stripe && i.stripeHostedInvoiceUrl && !["PAID", "VOID", "CANCELED"].includes(i.status) ? i.stripeHostedInvoiceUrl : null,
    })),
    files: order.files.map((f) => ({ url: f.media.url, name: f.label || f.media.originalName, mimeType: f.media.mimeType })),
  };
}
