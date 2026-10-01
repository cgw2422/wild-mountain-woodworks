import "server-only";
import { createHash } from "node:crypto";
import type { InvoiceKind, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { formatCents } from "@/lib/money";
import { sendTemplateEmail, type SendResult } from "@/lib/email/send";
import { getSettings, salesFlags } from "@/lib/settings";
import { siteDateLong } from "@/lib/site-time";
import { closeOpenCheckout } from "./checkout";
import { recordCustomerActivity } from "./customers";
import { SalesError } from "./errors";
import { recomputeInvoice } from "./ledger";
import { customerLinks } from "./links";
import { nextNumber } from "./numbers";
import type { Actor } from "./orders";
import { getInvoicingProvider } from "./stripe";
import { computeTotals, lineTotal, normalizeUnitPrice, type LineKind } from "./totals";
import { newCustomerToken } from "./tokens";

type Db = Prisma.TransactionClient;

export interface InvoiceLineInput {
  kind: LineKind;
  description: string;
  notes?: string | null;
  quantity: number;
  unitPriceCents: number;
  taxable?: boolean;
}

const DAY = 86_400_000;

function totalsData(lines: InvoiceLineInput[], taxCents = 0) {
  const t = computeTotals(lines, { depositType: "NONE" }, taxCents);
  return {
    subtotalCents: t.subtotalCents,
    discountCents: t.discountCents,
    deliveryCents: t.deliveryCents,
    otherChargesCents: t.otherChargesCents,
    taxCents: t.taxCents,
    totalCents: t.totalCents,
  };
}

function lineRows(lines: InvoiceLineInput[]) {
  return lines.map((l, i) => {
    const unit = normalizeUnitPrice(l.kind, l.unitPriceCents);
    return {
      position: i,
      kind: l.kind,
      description: l.description,
      notes: l.notes ?? null,
      quantity: Math.trunc(l.quantity),
      unitPriceCents: unit,
      lineTotalCents: lineTotal({ kind: l.kind, quantity: l.quantity, unitPriceCents: unit }),
      taxable: l.taxable ?? true,
    };
  });
}

/** Total of the order's other live (non-void, non-canceled) invoices. */
async function invoicedSoFar(db: Db | typeof prisma, orderId: string, excludeId?: string) {
  const rows = await db.invoice.findMany({ where: { orderId, status: { notIn: ["VOID", "CANCELED"] }, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { totalCents: true } });
  return rows.reduce((s, r) => s + r.totalCents, 0);
}

/**
 * Draft an invoice for an order:
 *  - DEPOSIT: the deposit agreed on the accepted quote
 *  - BALANCE: the order total minus everything already invoiced
 *  - FULL:    every line of the accepted quote (orders without a deposit)
 * Amounts come from the order/accepted revision on the server only.
 */
export async function createInvoiceForOrder(
  db: Db,
  orderId: string,
  kind: Exclude<InvoiceKind, "CUSTOM">,
  actorId: string | null,
  /**
   * issue: create it as an open payment request instead of a draft (the
   * deposit at quote acceptance — no admin "send" step). online: Stripe
   * payments are on (OPEN, payable by Checkout) vs offline (SENT).
   */
  opts: { issue?: boolean; online?: boolean } = {},
) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { quote: { select: { number: true } }, acceptedRevision: { include: { lineItems: { orderBy: { position: "asc" } } } } } });
  if (!order) throw new SalesError("That order no longer exists.");
  if (order.productionStatus === "CANCELED") throw new SalesError("This order is canceled.");
  const already = await invoicedSoFar(db, orderId);
  const settings = await db.siteSetting.findUnique({ where: { id: "default" }, select: { invoiceDueDays: true } });
  const quoteRef = order.quote?.number ? ` (quote ${order.quote.number})` : "";

  let lines: InvoiceLineInput[];
  let taxCents = 0;
  if (kind === "DEPOSIT") {
    if (order.depositCents <= 0) throw new SalesError("This order has no deposit.");
    const existing = await db.invoice.count({ where: { orderId, kind: "DEPOSIT", status: { notIn: ["VOID", "CANCELED"] } } });
    if (existing > 0) throw new SalesError("A deposit invoice already exists for this order.");
    lines = [{ kind: "CUSTOM", description: `Deposit for order ${order.number}${quoteRef}`, quantity: 1, unitPriceCents: order.depositCents, taxable: false }];
  } else if (kind === "BALANCE") {
    const remaining = order.totalCents - already;
    if (remaining <= 0) throw new SalesError("Everything on this order has already been invoiced.");
    lines = [
      {
        kind: "CUSTOM",
        description: `Final balance for order ${order.number}${quoteRef}`,
        notes: `Order total ${formatCents(order.totalCents)}; previously invoiced ${formatCents(already)}.`,
        quantity: 1,
        unitPriceCents: remaining,
        taxable: false,
      },
    ];
  } else {
    if (already > 0) throw new SalesError("Part of this order is already invoiced — create a final balance invoice instead.");
    const rev = order.acceptedRevision;
    if (!rev) throw new SalesError("This order has no accepted quote to invoice from.");
    lines = rev.lineItems.map((l) => ({ kind: l.kind as LineKind, description: l.description, notes: l.notes, quantity: l.quantity, unitPriceCents: l.unitPriceCents, taxable: l.taxable }));
    taxCents = rev.taxCents;
  }

  const number = await nextNumber("invoice", db);
  const initial = opts.issue ? (opts.online ? "OPEN" : "SENT") : "DRAFT";
  const invoice = await db.invoice.create({
    data: {
      number,
      kind,
      status: initial,
      sentAt: opts.issue ? new Date() : null,
      customerId: order.customerId,
      quoteId: order.quoteId,
      revisionId: order.acceptedRevisionId,
      orderId,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      ...totalsData(lines, taxCents),
      dueDate: new Date(Date.now() + (settings?.invoiceDueDays ?? 14) * DAY),
      publicToken: newCustomerToken(),
      createdById: actorId,
      lineItems: { create: lineRows(lines) },
      statusEvents: { create: { toStatus: initial, authorId: actorId } },
    },
  });
  return invoice;
}

/** A standalone invoice (e.g. extra work) for a customer, optionally tied to an order. */
export async function createCustomInvoice(actor: Actor, input: { customerId: string; orderId?: string | null; lines: InvoiceLineInput[]; dueDate: Date | null; customerNotes: string | null }) {
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw new SalesError("Customer not found.");
  const order = input.orderId ? await prisma.order.findFirst({ where: { id: input.orderId, customerId: customer.id } }) : null;
  if (input.orderId && !order) throw new SalesError("That order doesn't belong to this customer.");
  const totals = totalsData(input.lines);
  if (totals.totalCents <= 0) throw new SalesError("The invoice total must be more than $0.");
  const settings = await getSettings();
  const invoice = await prisma.$transaction(async (tx) =>
    tx.invoice.create({
      data: {
        number: await nextNumber("invoice", tx),
        kind: "CUSTOM",
        customerId: customer.id,
        orderId: order?.id ?? null,
        quoteId: order?.quoteId ?? null,
        customerName: customer.name,
        customerEmail: customer.email,
        ...totals,
        dueDate: input.dueDate ?? new Date(Date.now() + settings.invoiceDueDays * DAY),
        customerNotes: input.customerNotes,
        publicToken: newCustomerToken(),
        createdById: actor.id,
        lineItems: { create: lineRows(input.lines) },
        statusEvents: { create: { toStatus: "DRAFT", authorId: actor.id } },
      },
    }),
  );
  await logActivity("invoice.created", `${actor.name} created invoice ${invoice.number} for ${customer.name}`, { actorId: actor.id, entityType: "invoice", entityId: invoice.id });
  return invoice;
}

/** Edit a DRAFT invoice. Sent invoices are never edited — void and re-issue instead. */
export async function saveInvoiceDraft(actor: Actor, invoiceId: string, input: { lines: InvoiceLineInput[]; dueDate: Date | null; customerNotes: string | null; customerName: string; customerEmail: string }) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new SalesError("That invoice no longer exists.");
  if (invoice.status !== "DRAFT") throw new SalesError("Only draft invoices can be edited. Void it and create a new one instead.");
  const totals = totalsData(input.lines, invoice.taxCents);
  if (totals.totalCents <= 0) throw new SalesError("The invoice total must be more than $0.");
  if (invoice.orderId) {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: invoice.orderId }, select: { totalCents: true } });
    const others = await invoicedSoFar(prisma, invoice.orderId, invoice.id);
    if (invoice.kind !== "CUSTOM" && others + totals.totalCents > order.totalCents) {
      throw new SalesError(`That would invoice more than the order total (${formatCents(order.totalCents)}). Use a custom invoice for extra work.`);
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.invoiceLineItem.deleteMany({ where: { invoiceId } });
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { ...totals, dueDate: input.dueDate, customerNotes: input.customerNotes, customerName: input.customerName, customerEmail: input.customerEmail, lineItems: { create: lineRows(input.lines) } },
    });
  });
  if (totals.totalCents !== invoice.totalCents) {
    await logActivity("invoice.updated", `${actor.name} changed draft invoice ${invoice.number} total ${formatCents(invoice.totalCents)} → ${formatCents(totals.totalCents)}`, {
      actorId: actor.id,
      entityType: "invoice",
      entityId: invoiceId,
    });
  }
}

const TEMPLATE_BY_KIND: Record<InvoiceKind, string> = { DEPOSIT: "deposit_invoice", BALANCE: "balance_invoice", FULL: "invoice_sent", CUSTOM: "invoice_sent" };

async function emailInvoice(invoiceId: string, template?: string): Promise<SendResult> {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { order: { select: { number: true, customerToken: true } } } });
  const settings = await getSettings();
  const online = salesFlags(settings).stripeInvoicing;
  // Deposits are paid through Stripe Checkout from the stable order link; other invoices through Stripe's hosted page.
  const checkoutLink = online && invoice.kind === "DEPOSIT" && !invoice.stripeHostedInvoiceUrl && invoice.order?.customerToken ? customerLinks.depositPay(invoice.order.customerToken) : null;
  const stripe = online && (invoice.stripeHostedInvoiceUrl || checkoutLink);
  const url = checkoutLink ?? (stripe ? invoice.stripeHostedInvoiceUrl! : customerLinks.invoice(invoice.publicToken!));
  return sendTemplateEmail({
    template: template ?? TEMPLATE_BY_KIND[invoice.kind],
    to: invoice.customerEmail,
    vars: {
      customerName: invoice.customerName,
      invoiceNumber: invoice.number,
      orderNumber: invoice.order?.number,
      amountDue: formatCents(invoice.totalCents - invoice.amountPaidCents),
      dueDate: invoice.dueDate ? siteDateLong(invoice.dueDate) : "on receipt",
      paymentInstructions: stripe ? "You can pay securely online by card or bank transfer using the button below." : settings.paymentInstructions,
    },
    actionUrl: url,
    links: { customerId: invoice.customerId, invoiceId: invoice.id, orderId: invoice.orderId, quoteId: invoice.quoteId },
  });
}

/**
 * Send a draft invoice. With Stripe invoicing enabled the invoice is created
 * and finalized in Stripe (hosted payment page + PDF) and emailed either by
 * Stripe (option A) or by Wild Mountain with the hosted link (option B).
 * Without Stripe it is emailed with a link to the Wild Mountain invoice page
 * and paid offline. A Stripe failure leaves the invoice as a draft.
 */
export async function sendInvoice(actor: Actor, invoiceId: string): Promise<{ email: SendResult | null; via: "stripe" | "wild_mountain" }> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { lineItems: { orderBy: { position: "asc" } }, customer: true } });
  if (!invoice) throw new SalesError("That invoice no longer exists.");
  if (invoice.status !== "DRAFT") throw new SalesError("This invoice has already been sent. Use Resend instead.");
  if (invoice.totalCents <= 0) throw new SalesError("The invoice total must be more than $0.");
  const settings = await getSettings();
  const flags = salesFlags(settings);
  const now = new Date();
  const dueDate = invoice.dueDate && invoice.dueDate > now ? invoice.dueDate : new Date(now.getTime() + settings.invoiceDueDays * DAY);

  let stripeData: Prisma.InvoiceUpdateInput = {};
  if (flags.stripeInvoicing) {
    const provider = getInvoicingProvider();
    if (!provider) throw new SalesError("Stripe is not configured.");
    if (!invoice.customer) throw new SalesError("Link this invoice to a customer before sending it through Stripe.");
    try {
      const stripeCustomerId = await provider.ensureCustomer({ customerId: invoice.customer.id, name: invoice.customer.name, email: invoice.customerEmail, stripeCustomerId: invoice.customer.stripeCustomerId });
      if (stripeCustomerId !== invoice.customer.stripeCustomerId) {
        await prisma.customer.update({ where: { id: invoice.customer.id }, data: { stripeCustomerId } });
      }
      const lines = invoice.lineItems.map((l) => ({ description: l.quantity > 1 ? `${l.description} × ${l.quantity}` : l.description, amountCents: l.lineTotalCents }));
      const version = createHash("sha256").update(JSON.stringify([stripeCustomerId, lines, dueDate.toISOString(), invoice.customerNotes])).digest("hex").slice(0, 16);
      const created = await provider.createAndFinalizeInvoice({
        invoiceId: invoice.id,
        number: invoice.number,
        stripeCustomerId,
        lines,
        version,
        dueDate,
        description: invoice.customerNotes ?? `Invoice ${invoice.number}`,
        footer: settings.businessName,
      });
      if (settings.invoiceEmailMode === "STRIPE") await provider.sendInvoice(created.id, `wm-invoice-${invoice.id}-send`);
      stripeData = { stripeInvoiceId: created.id, stripeHostedInvoiceUrl: created.hostedInvoiceUrl, stripeInvoicePdfUrl: created.invoicePdfUrl, stripeStatus: created.status };
    } catch (error) {
      await logActivity("invoice.stripe_failed", `Stripe could not create invoice ${invoice.number}: ${error instanceof Error ? error.message : "error"}`.slice(0, 480), { actorId: actor.id, entityType: "invoice", entityId: invoice.id });
      throw new SalesError(`Stripe couldn't create the invoice (${error instanceof Error ? error.message : "unknown error"}). It is still a draft — nothing was sent.`);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { ...stripeData, status: flags.stripeInvoicing ? "OPEN" : "SENT", sentAt: now, dueDate, statusEvents: { create: { fromStatus: "DRAFT", toStatus: flags.stripeInvoicing ? "OPEN" : "SENT", authorId: actor.id } } },
    });
    await recomputeInvoice(tx, invoice.id, now);
    if (invoice.quoteId) await tx.quoteRequest.updateMany({ where: { id: invoice.quoteId, status: "ACCEPTED" }, data: { status: "CONVERTED_TO_INVOICE" } });
    await recordCustomerActivity(tx, { customerId: invoice.customerId, type: "invoice.sent", message: `Invoice ${invoice.number} sent (${formatCents(invoice.totalCents)})`, invoiceId: invoice.id, orderId: invoice.orderId, quoteId: invoice.quoteId, actorId: actor.id });
  });
  await logActivity("invoice.sent", `${actor.name} sent invoice ${invoice.number} (${formatCents(invoice.totalCents)})${flags.stripeInvoicing ? " via Stripe" : ""}`, { actorId: actor.id, entityType: "invoice", entityId: invoice.id });

  const stripeEmails = flags.stripeInvoicing && settings.invoiceEmailMode === "STRIPE";
  const email = stripeEmails ? null : await emailInvoice(invoice.id);
  return { email, via: stripeEmails ? "stripe" : "wild_mountain" };
}

/** Re-send an already-sent invoice (by Stripe or by Wild Mountain, matching the email setting), or a reminder. */
export async function resendInvoice(actor: Actor, invoiceId: string, reminder = false): Promise<SendResult | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new SalesError("That invoice no longer exists.");
  if (invoice.status === "DRAFT") throw new SalesError("Send the invoice first.");
  if (["PAID", "VOID", "CANCELED"].includes(invoice.status)) throw new SalesError("This invoice doesn't need to be sent again.");
  const settings = await getSettings();
  let result: SendResult | null = null;
  if (invoice.stripeInvoiceId && settings.invoiceEmailMode === "STRIPE" && !reminder) {
    const provider = getInvoicingProvider();
    if (!provider) throw new SalesError("Stripe is not configured.");
    await provider.sendInvoice(invoice.stripeInvoiceId, `wm-invoice-${invoice.id}-resend-${Date.now()}`);
  } else {
    result = await emailInvoice(invoice.id, reminder ? "invoice_reminder" : undefined);
  }
  await logActivity("invoice.sent", `${actor.name} ${reminder ? "sent a reminder for" : "resent"} invoice ${invoice.number}`, { actorId: actor.id, entityType: "invoice", entityId: invoice.id });
  return result;
}

/** Void an unpaid invoice (never deleted). Paid money must be refunded first. */
export async function voidInvoice(actor: Actor, invoiceId: string, reason: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new SalesError("That invoice no longer exists.");
  if (invoice.status === "VOID" || invoice.status === "CANCELED") throw new SalesError("This invoice is already void.");
  if (invoice.amountPaidCents > 0) throw new SalesError("This invoice has payments. Record a refund (or void the manual payment) before voiding it.");
  // Canceling a deposit request closes its online checkout so it can't be paid afterwards.
  await closeOpenCheckout(invoice.id);
  if (invoice.stripeInvoiceId) {
    const provider = getInvoicingProvider();
    if (!provider) throw new SalesError("Stripe is not configured, so the Stripe invoice can't be voided.");
    try {
      await provider.voidInvoice(invoice.stripeInvoiceId, `wm-invoice-${invoice.id}-void`);
    } catch (error) {
      throw new SalesError(`Stripe couldn't void the invoice: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "VOID", voidedAt: now, voidReason: reason, statusEvents: { create: { fromStatus: invoice.status, toStatus: "VOID", authorId: actor.id } } } });
    await recordCustomerActivity(tx, { customerId: invoice.customerId, type: "invoice.voided", message: `Invoice ${invoice.number} voided: ${reason}`, invoiceId, orderId: invoice.orderId, actorId: actor.id });
  });
  await logActivity("invoice.voided", `${actor.name} voided invoice ${invoice.number}: ${reason}`, { actorId: actor.id, entityType: "invoice", entityId: invoiceId });
}
