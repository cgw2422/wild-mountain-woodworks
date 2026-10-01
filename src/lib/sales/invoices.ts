import "server-only";
import type { InvoiceStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { formatCents } from "@/lib/money";
import { sendTemplateEmail, type SendResult } from "@/lib/email/send";
import { getSettings, salesFlags } from "@/lib/settings";
import { closeOpenCheckout } from "./checkout";
import { recordCustomerActivity } from "./customers";
import { SalesError } from "./errors";
import { invoiceMoney, recomputeInvoice, recomputeOrderPayment } from "./ledger";
import { customerLinks } from "./links";
import { nextNumber } from "./numbers";
import type { Actor } from "./orders";
import { getInvoicingProvider } from "./stripe";
import { computeTotals, lineTotal, normalizeUnitPrice, type LineKind } from "./totals";
import { newCustomerToken } from "./tokens";

/*
 * One Wild Mountain Woodworks invoice per order. It is created when the quote is
 * accepted, carries the whole accepted total plus the deposit required, and
 * every payment — deposit, final balance, cash, check, Terminal — is applied
 * to it. The final balance is requested on the same invoice ("Mark balance
 * due"), never by creating a second invoice, and the customer always pays
 * from the Wild Mountain Woodworks invoice page (Stripe Checkout processes the card).
 * Stripe Invoicing is not used for new invoices; older Stripe-backed
 * invoices keep working.
 */

type Db = Prisma.TransactionClient;

export interface InvoiceLineInput {
  kind: LineKind;
  description: string;
  notes?: string | null;
  quantity: number;
  unitPriceCents: number;
  taxable?: boolean;
}

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

const LIVE = { notIn: ["VOIDED", "CANCELED"] as InvoiceStatus[] };

/** The order's invoices that still count (not voided/canceled). */
export function liveOrderInvoices(db: Db | typeof prisma, orderId: string) {
  return db.invoice.findMany({ where: { orderId, status: LIVE }, orderBy: { createdAt: "asc" } });
}

/** The invoice customers pay against for an order: the first live, issued one with something still owed (else the first live one). */
export async function primaryInvoiceFor(db: Db | typeof prisma, orderId: string) {
  const live = (await liveOrderInvoices(db, orderId)).filter((i) => i.status !== "DRAFT");
  return live.find((i) => i.totalCents > i.amountPaidCents) ?? live[0] ?? null;
}

/**
 * The single invoice for an order (inside the acceptance transaction, or by
 * an admin after an earlier invoice was voided). Lines and amounts come from
 * the accepted quote revision on the server only. Older orders that already
 * have deposit/balance invoices get a "remaining balance" invoice instead,
 * so no issued record is ever rewritten.
 */
export async function createOrderInvoice(db: Db, orderId: string, actorId: string | null) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { quote: { select: { number: true, status: true } }, acceptedRevision: { include: { lineItems: { orderBy: { position: "asc" } } } }, items: { orderBy: { position: "asc" } } } });
  if (!order) throw new SalesError("That order no longer exists.");
  if (order.productionStatus === "CANCELED") throw new SalesError("This order is canceled.");
  if (order.quote?.status === "VOIDED") throw new SalesError(`Quote ${order.quote.number} is voided, so nothing can be invoiced from it.`);
  const live = await liveOrderInvoices(db, orderId);
  const quoteRef = order.quote?.number ? ` (quote ${order.quote.number})` : "";
  const base = {
    customerId: order.customerId,
    quoteId: order.quoteId,
    revisionId: order.acceptedRevisionId,
    orderId,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    publicToken: newCustomerToken(),
    createdById: actorId,
    sentAt: new Date(),
  };

  let data: Prisma.InvoiceUncheckedCreateInput;
  if (live.length === 0) {
    const rev = order.acceptedRevision;
    const lines: InvoiceLineInput[] = rev
      ? rev.lineItems.map((l) => ({ kind: l.kind as LineKind, description: l.description, notes: l.notes, quantity: l.quantity, unitPriceCents: l.unitPriceCents, taxable: l.taxable }))
      : order.items.map((l) => ({ kind: l.kind as LineKind, description: l.description ?? l.productName, notes: l.notes, quantity: l.quantity, unitPriceCents: l.unitPriceCents, taxable: false }));
    const totals = totalsData(lines, rev?.taxCents ?? order.taxCents);
    if (totals.totalCents !== order.totalCents) logger.warn("Order invoice total differs from the order total", { orderId, invoice: totals.totalCents, order: order.totalCents });
    data = {
      ...base,
      number: await nextNumber("invoice", db),
      kind: "FULL",
      status: "OPEN",
      ...totals,
      depositCents: Math.min(order.depositCents, totals.totalCents),
      customerNotes: rev?.customerNotes ?? null,
      lineItems: { create: lineRows(lines) },
    };
  } else {
    if (live.some((i) => i.kind === "FULL")) throw new SalesError("This order already has its invoice. Payments and the final balance go on that invoice.");
    const invoiced = live.reduce((s, i) => s + i.totalCents, 0);
    const remaining = order.totalCents - invoiced;
    if (remaining <= 0) throw new SalesError("Everything on this order is already invoiced.");
    const lines: InvoiceLineInput[] = [
      { kind: "CUSTOM", description: `Remaining balance for order ${order.number}${quoteRef}`, notes: `Order total ${formatCents(order.totalCents)}; already invoiced ${formatCents(invoiced)}.`, quantity: 1, unitPriceCents: remaining, taxable: false },
    ];
    data = { ...base, number: await nextNumber("invoice", db), kind: "BALANCE", status: "OPEN", ...totalsData(lines), depositCents: 0, lineItems: { create: lineRows(lines) } };
  }
  const invoice = await db.invoice.create({ data: { ...data, statusEvents: { create: { toStatus: "OPEN", authorId: actorId } } } });
  await recomputeInvoice(db, invoice.id);
  return db.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
}

/** A standalone invoice for special situations (e.g. extra work), optionally tied to an order. Starts as a draft. */
export async function createCustomInvoice(actor: Actor, input: { customerId: string; orderId?: string | null; lines: InvoiceLineInput[]; dueDate: Date | null; customerNotes: string | null }) {
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw new SalesError("Customer not found.");
  const order = input.orderId ? await prisma.order.findFirst({ where: { id: input.orderId, customerId: customer.id }, include: { quote: { select: { number: true, status: true } } } }) : null;
  if (input.orderId && !order) throw new SalesError("That order doesn't belong to this customer.");
  if (order?.productionStatus === "CANCELED") throw new SalesError("This order is canceled.");
  if (order?.quote?.status === "VOIDED") throw new SalesError(`Quote ${order.quote.number} is voided, so nothing can be invoiced from it.`);
  const totals = totalsData(input.lines);
  if (totals.totalCents <= 0) throw new SalesError("The invoice total must be more than $0.");
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
        dueDate: input.dueDate,
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

/** Edit a DRAFT invoice. Issued invoices are never edited — void and re-issue instead. */
export async function saveInvoiceDraft(actor: Actor, invoiceId: string, input: { lines: InvoiceLineInput[]; dueDate: Date | null; customerNotes: string | null; customerName: string; customerEmail: string }) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new SalesError("That invoice no longer exists.");
  if (invoice.status !== "DRAFT") throw new SalesError("Only draft invoices can be edited. Void it and create a new one instead.");
  const totals = totalsData(input.lines, invoice.taxCents);
  if (totals.totalCents <= 0) throw new SalesError("The invoice total must be more than $0.");
  await prisma.$transaction(async (tx) => {
    await tx.invoiceLineItem.deleteMany({ where: { invoiceId } });
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { ...totals, dueDate: input.dueDate, customerNotes: input.customerNotes, customerName: input.customerName, customerEmail: input.customerEmail, lineItems: { create: lineRows(input.lines) } },
    });
  });
  if (totals.totalCents !== invoice.totalCents) {
    await logActivity("invoice.updated", `${actor.name} changed draft invoice ${invoice.number} total ${formatCents(invoice.totalCents)} → ${formatCents(totals.totalCents)}`, { actorId: actor.id, entityType: "invoice", entityId: invoiceId });
  }
}

type InvoiceEmail = "invoice_sent" | "invoice_reminder" | "balance_due";

/** Email the customer a link to the Wild Mountain Woodworks invoice page (never straight to Stripe). */
export async function emailInvoiceLink(invoiceId: string, template: InvoiceEmail = "invoice_sent"): Promise<SendResult> {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { order: { select: { number: true } } } });
  if (!invoice.publicToken) throw new SalesError("This invoice has no customer link.");
  const money = invoiceMoney(invoice);
  const online = salesFlags(await getSettings()).onlinePayments;
  const settings = await getSettings();
  return sendTemplateEmail({
    template,
    to: invoice.customerEmail,
    vars: {
      customerName: invoice.customerName,
      invoiceNumber: invoice.number,
      orderNumber: invoice.order?.number,
      total: formatCents(invoice.totalCents),
      amountPaid: formatCents(money.paidCents),
      amountDue: formatCents(money.dueNowCents || money.remainingCents),
      balanceRemaining: formatCents(money.remainingCents),
      paymentInstructions: online ? "You can review your invoice and pay securely online from the link below." : settings.paymentInstructions,
      // Older stored copies of the invoice templates use {{dueDate}}.
      dueDate: "on receipt",
    },
    actionUrl: customerLinks.invoice(invoice.publicToken),
    links: { customerId: invoice.customerId, invoiceId: invoice.id, orderId: invoice.orderId, quoteId: invoice.quoteId },
  });
}

/**
 * Issue a draft (custom) invoice: it becomes payable in full and the customer
 * is emailed the Wild Mountain Woodworks invoice link. Nothing is created in Stripe.
 */
export async function sendInvoice(actor: Actor, invoiceId: string): Promise<{ email: SendResult | null }> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new SalesError("That invoice no longer exists.");
  if (invoice.status !== "DRAFT") throw new SalesError("This invoice has already been sent. Use Resend instead.");
  if (invoice.totalCents <= 0) throw new SalesError("The invoice total must be more than $0.");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id: invoice.id }, data: { status: "OPEN", sentAt: now, balanceDueAt: now, balanceRequestedById: actor.id, statusEvents: { create: { fromStatus: "DRAFT", toStatus: "OPEN", authorId: actor.id } } } });
    await recomputeInvoice(tx, invoice.id, now);
    await recordCustomerActivity(tx, { customerId: invoice.customerId, type: "invoice.sent", message: `Invoice ${invoice.number} sent (${formatCents(invoice.totalCents)})`, invoiceId: invoice.id, orderId: invoice.orderId, quoteId: invoice.quoteId, actorId: actor.id });
  });
  await logActivity("invoice.sent", `${actor.name} sent invoice ${invoice.number} (${formatCents(invoice.totalCents)})`, { actorId: actor.id, entityType: "invoice", entityId: invoice.id });
  return { email: await emailInvoiceLink(invoice.id) };
}

/** Email the invoice link again (or a friendly reminder). */
export async function resendInvoice(actor: Actor, invoiceId: string, reminder = false): Promise<SendResult | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new SalesError("That invoice no longer exists.");
  if (invoice.status === "DRAFT") throw new SalesError("Send the invoice first.");
  if (invoice.status === "VOIDED" || invoice.status === "CANCELED") throw new SalesError("This invoice is voided.");
  if (reminder && invoice.status === "PAID") throw new SalesError("This invoice is paid — no reminder needed.");
  const result = await emailInvoiceLink(invoiceId, reminder ? "invoice_reminder" : "invoice_sent");
  await logActivity("invoice.sent", `${actor.name} ${reminder ? "sent a reminder for" : "emailed the link to"} invoice ${invoice.number}`, { actorId: actor.id, entityType: "invoice", entityId: invoiceId });
  return result;
}

/**
 * Request the final balance on the SAME invoice: it becomes BALANCE_DUE and
 * the customer is emailed a link to the Wild Mountain Woodworks invoice page, where
 * they can pay the remaining balance. No second invoice, nothing in Stripe
 * until the customer chooses to pay.
 */
export async function markBalanceDue(actor: Actor, invoiceId: string): Promise<SendResult> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { order: { select: { number: true, productionStatus: true } } } });
  if (!invoice) throw new SalesError("That invoice no longer exists.");
  if (invoice.status === "VOIDED" || invoice.status === "CANCELED") throw new SalesError("This invoice is voided.");
  if (invoice.status === "DRAFT") throw new SalesError("Send the invoice first.");
  if (invoice.order?.productionStatus === "CANCELED") throw new SalesError("This order is canceled.");
  const money = invoiceMoney(invoice);
  if (money.remainingCents <= 0) throw new SalesError("This invoice is already paid in full.");
  if (invoice.balanceDueAt) throw new SalesError("The balance is already due. Use “Resend invoice link” to email the customer again.");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const res = await tx.invoice.updateMany({ where: { id: invoiceId, balanceDueAt: null }, data: { balanceDueAt: now, balanceRequestedById: actor.id } });
    if (!res.count) throw new SalesError("The balance was just marked due. Reload the page.");
    await recomputeInvoice(tx, invoiceId, now);
    await recordCustomerActivity(tx, { customerId: invoice.customerId, type: "invoice.balance_due", message: `Final balance requested on ${invoice.number}: ${formatCents(money.remainingCents)}`, invoiceId, orderId: invoice.orderId, actorId: actor.id });
  });
  await logActivity("invoice.balance_due", `${actor.name} marked the balance due on ${invoice.number}${invoice.order ? ` (order ${invoice.order.number})` : ""}: ${formatCents(money.remainingCents)} remaining`, { actorId: actor.id, entityType: "invoice", entityId: invoiceId });
  // An open deposit checkout is now for the wrong amount; the pay link opens a fresh one.
  await closeOpenCheckout(invoiceId).catch(() => undefined);
  return emailInvoiceLink(invoiceId, "balance_due");
}

/** Void an invoice (never deleted). Money already received must be refunded first, so payment history stays consistent. */
export async function voidInvoice(actor: Actor, invoiceId: string, reason: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new SalesError("That invoice no longer exists.");
  if (invoice.status === "VOIDED" || invoice.status === "CANCELED") throw new SalesError("This invoice is already void.");
  if (invoice.amountPaidCents > 0) throw new SalesError("This invoice has payments. Record a refund (or void the manual payment) before voiding it.");
  if (invoice.pendingCents > 0) throw new SalesError("A payment on this invoice is still pending (a check to clear or a card on the reader). Resolve it before voiding.");
  // Close any open online checkout so it can't be paid afterwards.
  await closeOpenCheckout(invoice.id);
  if (invoice.stripeInvoiceId) {
    // Older Stripe-backed invoices are voided in Stripe too.
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
    // Conditional: a payment landing at the same moment wins and the void is refused.
    const res = await tx.invoice.updateMany({ where: { id: invoiceId, status: invoice.status, amountPaidCents: 0, pendingCents: 0 }, data: { status: "VOIDED", voidedAt: now, voidedById: actor.id, voidReason: reason } });
    if (!res.count) throw new SalesError("This invoice just changed (a payment may have arrived). Reload and check before voiding.");
    await tx.statusEvent.create({ data: { invoiceId, fromStatus: invoice.status, toStatus: "VOIDED", authorId: actor.id } });
    await recordCustomerActivity(tx, { customerId: invoice.customerId, type: "invoice.voided", message: `Invoice ${invoice.number} voided: ${reason}`, invoiceId, orderId: invoice.orderId, actorId: actor.id });
    if (invoice.orderId) await recomputeOrderPayment(tx, invoice.orderId, now);
  });
  await logActivity("invoice.voided", `${actor.name} voided invoice ${invoice.number} (${formatCents(invoice.totalCents)}, was ${invoice.status.toLowerCase().replace(/_/g, " ")}). Reason: ${reason}`.slice(0, 480), { actorId: actor.id, entityType: "invoice", entityId: invoiceId });
}
