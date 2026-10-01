"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { AdminError, adminAction, fd, permittedAction } from "@/lib/admin/action";
import type { ActionResult } from "@/lib/admin/types";
import { parseDollarsToCents } from "@/lib/money";
import { siteDateTime, siteDayStart } from "@/lib/site-time";
import { resendLoggedEmail, type SendResult } from "@/lib/email/send";
import { EMAIL_TEMPLATE_KEYS } from "@/lib/email/template-definitions";
import { recordCustomerActivity } from "@/lib/sales/customers";
import { createCustomInvoice, createOrderInvoice, markBalanceDue, resendInvoice, saveInvoiceDraft, sendInvoice, voidInvoice, type InvoiceLineInput } from "@/lib/sales/invoices";
import { markCheckCleared, markCheckReturned, recordManualPayment, recordRefund, sendDepositPaymentRequest, voidManualPayment } from "@/lib/sales/payments";
import { resendStatusEmail, updateOrder } from "@/lib/sales/orders";
import { cancelTerminalPayment, refreshTerminalPayment, setTerminalReader, simulateTerminalPayment, startTerminalPayment, terminalTestMode } from "@/lib/sales/terminal";
import {
  MANUAL_QUOTE_STATUSES,
  acceptQuoteManually,
  createManualQuote,
  createRevision,
  duplicateQuote,
  extendQuote,
  reopenQuote,
  resendQuote,
  saveRevision,
  sendQuote,
  setQuoteArchived,
  setQuoteStatus,
  voidQuote,
} from "@/lib/sales/quotes";
import { voidReasonText } from "@/lib/sales/voiding";
import { DELIVERY_METHODS, PRODUCTION_STATUSES } from "@/lib/sales/status";
import { DEPOSIT_TYPES, LINE_KINDS, MAX_LINES, MAX_LINE_QUANTITY, MAX_UNIT_PRICE_CENTS, parsePercentToBps } from "@/lib/sales/totals";
import { emailSchema, nameSchema, phoneSchema } from "@/lib/validation/forms";

/*
 * Admin actions for quotes, orders, invoices, payments and customers.
 * Permissions (checked on the server for every call):
 *   "sales"   — quotes workflow, customers, orders/production
 *   "finance" — quote pricing, invoices, payments, refunds
 * Editors have neither. All amounts are recomputed by src/lib/sales.
 */

const PRICING: ["sales", "finance"] = ["sales", "finance"];
const idSchema = z.string().min(1).max(64);

function refreshSales(...paths: string[]) {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/admin", "layout");
}

function emailOutcome(r: SendResult | null, sent: string): ActionResult {
  if (!r) return { ok: true, message: sent };
  if (r.status === "FAILED") return { ok: true, message: `${sent} — but the email failed to send. You can resend it from the email log.` };
  if (r.status === "SKIPPED") return { ok: true, message: `${sent} (email template is switched off — no email was sent).` };
  return { ok: true, message: sent };
}

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const moneyCents = (label: string, allowNegative = false) =>
  z
    .number({ error: `Enter a price for ${label}.` })
    .int()
    .min(allowNegative ? -MAX_UNIT_PRICE_CENTS : 0, "That amount is out of range.")
    .max(MAX_UNIT_PRICE_CENTS, "That amount is out of range.");

const lineSchema = z.object({
  sourceId: z.string().max(40).nullable().optional().transform((v) => v ?? null),
  kind: z.enum(LINE_KINDS),
  description: z.string().trim().min(1, "Every line needs a description.").max(500),
  notes: optText(2000),
  quantity: z.number().int().min(1, "Quantity must be at least 1.").max(MAX_LINE_QUANTITY),
  unitPriceCents: moneyCents("each line", true),
  taxable: z.boolean().default(true),
  productId: z.string().max(40).nullable().optional().transform((v) => v ?? null),
});

function dayInput(value: string | null | undefined, field: string): Date | null {
  if (!value) return null;
  const start = siteDayStart(value, 1);
  if (!start) throw new AdminError("Enter a valid date.", { [field]: "Enter a valid date." });
  return start;
}

/* ================================================================ quotes */

const revisionSchema = z.object({
  customerName: nameSchema,
  customerEmail: emailSchema,
  customerPhone: phoneSchema,
  customerAddress: optText(300),
  customerNotes: optText(5000),
  terms: optText(20000),
  expiresOn: z.string().trim().max(10).optional().nullable(),
  leadTime: optText(120),
  estimatedCompletion: optText(120),
  deliveryDetails: optText(1000),
  depositType: z.enum(DEPOSIT_TYPES),
  depositPercent: z.string().trim().max(10).optional().nullable(),
  depositAmountCents: z.number().int().min(0).max(MAX_UNIT_PRICE_CENTS * 10).nullable().optional(),
  taxCents: z.number().int().min(0).max(MAX_UNIT_PRICE_CENTS).default(0),
  lines: z.array(lineSchema).max(MAX_LINES, `Up to ${MAX_LINES} lines.`),
});

function parsePayload(data: FormData) {
  try {
    return JSON.parse(fd.str(data, "payload")) as unknown;
  } catch {
    throw new AdminError("The form data was invalid. Please reload and try again.");
  }
}

/** Save the current draft revision (lines, customer, deposit, terms). */
export const saveQuoteRevisionAction = permittedAction(PRICING, async (admin, quoteIdArg: string, data: FormData) => {
  const quoteId = idSchema.parse(quoteIdArg);
  const input = revisionSchema.parse(parsePayload(data));
  let depositPercentBps: number | null = null;
  if (input.depositType === "PERCENTAGE") {
    depositPercentBps = parsePercentToBps(input.depositPercent);
    if (!Number.isFinite(depositPercentBps) || depositPercentBps <= 0 || depositPercentBps > 10000) throw new AdminError("Enter a deposit percentage between 0.01 and 100.", { depositPercent: "Enter 1–100." });
  }
  if (input.depositType === "FIXED_AMOUNT" && !input.depositAmountCents) throw new AdminError("Enter the deposit amount.", { depositAmount: "Enter an amount." });
  const expiresAt = dayInput(input.expiresOn, "expiresOn");
  const totals = await saveRevision(admin, quoteId, {
    ...input,
    expiresAt,
    depositPercentBps,
    depositAmountCents: input.depositType === "FIXED_AMOUNT" ? (input.depositAmountCents ?? null) : null,
  });
  refreshSales("/admin/quotes", `/admin/quotes/${quoteId}`);
  return { ok: true, message: `Saved. Total ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totals.totalCents / 100)}.` };
});

export const sendQuoteAction = permittedAction(PRICING, async (admin, quoteIdArg: string) => {
  const quoteId = idSchema.parse(quoteIdArg);
  const r = await sendQuote(admin, quoteId);
  refreshSales("/admin/quotes", `/admin/quotes/${quoteId}`);
  return emailOutcome(r, "Quote sent to the customer.");
});

export const resendQuoteAction = permittedAction("sales", async (admin, quoteIdArg: string) => {
  const quoteId = idSchema.parse(quoteIdArg);
  const r = await resendQuote(admin, quoteId);
  refreshSales(`/admin/quotes/${quoteId}`);
  return emailOutcome(r, "Quote email sent again.");
});

export const createRevisionAction = permittedAction(PRICING, async (admin, quoteIdArg: string) => {
  const quoteId = idSchema.parse(quoteIdArg);
  const rev = await createRevision(admin, quoteId);
  refreshSales(`/admin/quotes/${quoteId}`);
  return { ok: true, message: `Revision ${rev.number} started. The customer keeps seeing the sent version until you send this one.` };
});

export const duplicateQuoteAction = permittedAction(PRICING, async (admin, quoteIdArg: string) => {
  const copy = await duplicateQuote(admin, idSchema.parse(quoteIdArg));
  refreshSales("/admin/quotes");
  return { ok: true, id: copy.id, message: `Created ${copy.number}.` };
});

export const acceptQuoteManuallyAction = permittedAction("sales", async (admin, quoteIdArg: string, data: FormData) => {
  const quoteId = idSchema.parse(quoteIdArg);
  const note = z.string().trim().min(3, "Say how the customer accepted (e.g. by phone on 10/2).").max(500).parse(fd.str(data, "note"));
  const order = await acceptQuoteManually(admin, quoteId, note);
  refreshSales("/admin/quotes", `/admin/quotes/${quoteId}`, "/admin/orders");
  return { ok: true, id: order.id, message: `Acceptance recorded. Order ${order.number} created.` };
});

export const extendQuoteAction = permittedAction("sales", async (admin, quoteIdArg: string, data: FormData) => {
  const quoteId = idSchema.parse(quoteIdArg);
  const expiresAt = dayInput(fd.str(data, "expiresOn"), "expiresOn");
  if (!expiresAt) throw new AdminError("Choose the new last day.", { expiresOn: "Choose a date." });
  await extendQuote(admin, quoteId, expiresAt);
  refreshSales(`/admin/quotes/${quoteId}`);
  return { ok: true, message: "Expiration extended." };
});

export const setQuoteStatusAction = permittedAction("sales", async (admin, quoteIdArg: string, data: FormData) => {
  const quoteId = idSchema.parse(quoteIdArg);
  const status = z.enum(MANUAL_QUOTE_STATUSES as [string, ...string[]], { error: "Choose a valid status." }).parse(fd.str(data, "status"));
  await setQuoteStatus(admin, quoteId, status as (typeof MANUAL_QUOTE_STATUSES)[number], fd.opt(data, "note"));
  refreshSales("/admin/quotes", `/admin/quotes/${quoteId}`);
  return { ok: true, message: "Status updated." };
});

/** Never deleted: the quote stays in history but can't be accepted, invoiced or paid. */
export const voidQuoteAction = permittedAction("sales", async (admin, quoteIdArg: string, data: FormData) => {
  const quoteId = idSchema.parse(quoteIdArg);
  const reason = voidReasonText(fd.str(data, "reason"), fd.opt(data, "details"));
  await voidQuote(admin, quoteId, reason);
  refreshSales("/admin/quotes", `/admin/quotes/${quoteId}`);
  return { ok: true, message: "Quote voided — it stays in history but can no longer be accepted, invoiced or paid." };
});

/** Owner/Admin only, and only when nothing has happened that would make the quote ambiguous. */
export const reopenQuoteAction = adminAction(async (admin, quoteIdArg: string) => {
  const quoteId = idSchema.parse(quoteIdArg);
  await reopenQuote(admin, quoteId);
  refreshSales("/admin/quotes", `/admin/quotes/${quoteId}`);
  return { ok: true, message: "Quote reopened." };
});

export const archiveQuoteAction = permittedAction("sales", async (admin, quoteIdArg: string, archived: boolean) => {
  const quoteId = idSchema.parse(quoteIdArg);
  await setQuoteArchived(admin, quoteId, Boolean(archived));
  refreshSales("/admin/quotes", `/admin/quotes/${quoteId}`);
  return { ok: true, message: archived ? "Quote archived." : "Quote restored." };
});

const manualQuoteSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  zipCode: z.string().trim().max(10).default(""),
  address: optText(300),
  notes: optText(4000),
});

export const createManualQuoteAction = permittedAction(PRICING, async (admin, data: FormData) => {
  const input = manualQuoteSchema.parse({
    name: fd.str(data, "name"),
    email: fd.str(data, "email"),
    phone: fd.str(data, "phone"),
    zipCode: fd.str(data, "zipCode"),
    address: fd.str(data, "address"),
    notes: fd.str(data, "notes"),
  });
  const productId = fd.opt(data, "productId");
  const product = productId ? await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, basePriceCents: true } }) : null;
  const quote = await createManualQuote(admin, {
    ...input,
    productId: product?.id ?? null,
    productName: product?.name ?? null,
    lines: product
      ? [{ kind: "PRODUCT", description: product.name, notes: null, quantity: 1, unitPriceCents: product.basePriceCents ?? 0, taxable: true, productId: product.id, configuration: null }]
      : undefined,
  });
  refreshSales("/admin/quotes");
  return { ok: true, id: quote.id, message: `Quote ${quote.number} created.` };
});

/* ================================================================ attachments */

export const addSalesAttachmentAction = permittedAction("sales", async (admin, target: "quote" | "order", idArg: string, data: FormData) => {
  const id = idSchema.parse(idArg);
  if (target !== "quote" && target !== "order") throw new AdminError("Unknown record type.");
  const mediaId = idSchema.parse(fd.str(data, "mediaId"));
  const media = await prisma.media.findUnique({ where: { id: mediaId }, select: { id: true } });
  if (!media) throw new AdminError("Choose a file from the media library.", { mediaId: "Choose a file." });
  const exists = target === "quote" ? await prisma.quoteRequest.count({ where: { id } }) : await prisma.order.count({ where: { id } });
  if (!exists) throw new AdminError("That record no longer exists.");
  await prisma.salesAttachment.create({
    data: { mediaId, label: fd.opt(data, "label")?.slice(0, 120) ?? null, customerVisible: fd.bool(data, "customerVisible"), createdById: admin.id, ...(target === "quote" ? { quoteId: id } : { orderId: id }) },
  });
  refreshSales(`/admin/${target === "quote" ? "quotes" : "orders"}/${id}`);
  return { ok: true, message: "File attached." };
});

export const setSalesAttachmentVisibilityAction = permittedAction("sales", async (_admin, attachmentId: string, visible: boolean) => {
  const a = await prisma.salesAttachment.update({ where: { id: idSchema.parse(attachmentId) }, data: { customerVisible: Boolean(visible) } });
  refreshSales(a.quoteId ? `/admin/quotes/${a.quoteId}` : `/admin/orders/${a.orderId}`);
  return { ok: true, message: visible ? "Now visible to the customer." : "Now internal only." };
});

export const removeSalesAttachmentAction = permittedAction("sales", async (_admin, attachmentId: string) => {
  // Removes only the link; the media file stays in the library.
  const a = await prisma.salesAttachment.delete({ where: { id: idSchema.parse(attachmentId) } });
  refreshSales(a.quoteId ? `/admin/quotes/${a.quoteId}` : `/admin/orders/${a.orderId}`);
  return { ok: true, message: "File removed from this record." };
});

/* ================================================================ orders */

const orderSchema = z.object({
  productionStatus: z.enum(PRODUCTION_STATUSES),
  deliveryDate: z.string().trim().max(20).optional(),
  deliveryWindow: optText(60),
  deliveryMethod: z.enum([...DELIVERY_METHODS, ""]).optional(),
  deliveryAddress: optText(300),
  deliveryNotes: optText(1000),
  estimatedCompletion: optText(120),
  productionNotes: optText(5000),
  customerNotes: optText(5000),
});

/** Production stage, delivery details and notes. A status change emails the customer unless "Send email notification" is unticked. */
export const updateOrderAction = permittedAction("sales", async (admin, orderIdArg: string, data: FormData) => {
  const orderId = idSchema.parse(orderIdArg);
  const input = orderSchema.parse({
    productionStatus: fd.str(data, "productionStatus"),
    deliveryDate: fd.str(data, "deliveryDate"),
    deliveryWindow: fd.str(data, "deliveryWindow"),
    deliveryMethod: fd.str(data, "deliveryMethod"),
    deliveryAddress: fd.str(data, "deliveryAddress"),
    deliveryNotes: fd.str(data, "deliveryNotes"),
    estimatedCompletion: fd.str(data, "estimatedCompletion"),
    productionNotes: fd.str(data, "productionNotes"),
    customerNotes: fd.str(data, "customerNotes"),
  });
  let deliveryDate: Date | null = null;
  if (input.deliveryDate) {
    deliveryDate = siteDateTime(input.deliveryDate.length === 10 ? `${input.deliveryDate}T09:00` : input.deliveryDate);
    if (!deliveryDate) throw new AdminError("Enter a valid delivery date.", { deliveryDate: "Enter a valid date." });
  }
  const r = await updateOrder(admin, orderId, { ...input, deliveryMethod: input.deliveryMethod || null, deliveryDate, notifyCustomer: fd.bool(data, "notifyCustomer") });
  refreshSales("/admin/orders", `/admin/orders/${orderId}`);
  if (!r.productionChanged) return { ok: true, message: "Order updated." };
  if (r.notification === "SENT") return { ok: true, message: "Status updated and the customer was emailed." };
  if (r.notification === "FAILED") return { ok: true, message: `Status updated — but the customer email failed${r.error ? ` (${r.error})` : ""}. Use “Resend status email”.` };
  if (r.notification === "SUPPRESSED") return { ok: true, message: "Status updated (no email sent, as requested)." };
  if (r.notification === "SKIPPED") return { ok: true, message: "Status updated (the email template is switched off, so nothing was sent)." };
  return { ok: true, message: "Status updated." };
});

export const resendStatusEmailAction = permittedAction("sales", async (admin, orderIdArg: string) => {
  const orderId = idSchema.parse(orderIdArg);
  const r = await resendStatusEmail(admin, orderId);
  refreshSales(`/admin/orders/${orderId}`);
  if (r.status === "SENT") return { ok: true, message: "Status email sent." };
  if (r.status === "SKIPPED") return { ok: true, message: "The email template is switched off — nothing was sent." };
  return { ok: false, message: `The email failed${r.result?.error ? `: ${r.result.error}` : ""}. Try again in a moment.` };
});

/** The order's one invoice (only when it has none, e.g. after voiding one). Older orders get a remaining-balance invoice. */
export const createOrderInvoiceAction = permittedAction("finance", async (admin, orderIdArg: string) => {
  const orderId = idSchema.parse(orderIdArg);
  const invoice = await prisma.$transaction((tx) => createOrderInvoice(tx, orderId, admin.id));
  await logActivity("invoice.created", `${admin.name} created invoice ${invoice.number} for the order (${invoice.kind === "FULL" ? "order invoice" : "remaining balance"})`, { actorId: admin.id, entityType: "invoice", entityId: invoice.id });
  refreshSales(`/admin/orders/${orderId}`, "/admin/invoices");
  return { ok: true, id: invoice.id, message: `Invoice ${invoice.number} created.` };
});

/** Request the final balance on the same invoice and email the customer the Wild Mountain Woodworks invoice link. */
export const markBalanceDueAction = permittedAction("finance", async (admin, invoiceIdArg: string) => {
  const invoiceId = idSchema.parse(invoiceIdArg);
  const r = await markBalanceDue(admin, invoiceId);
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { orderId: true } });
  refreshSales("/admin/invoices", `/admin/invoices/${invoiceId}`, ...(inv?.orderId ? [`/admin/orders/${inv.orderId}`] : []));
  return emailOutcome(r, "Balance marked due — the customer was emailed a link to their invoice.");
});

/** Email the customer the stable link to pay what's due now (deposit or balance). */
export const resendDepositLinkAction = permittedAction("finance", async (admin, invoiceIdArg: string) => {
  const invoiceId = idSchema.parse(invoiceIdArg);
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { status: true, number: true, orderId: true } });
  if (!invoice || ["VOIDED", "CANCELED", "PAID", "DRAFT"].includes(invoice.status)) throw new AdminError("There's nothing to pay on this invoice.");
  const r = await sendDepositPaymentRequest(invoiceId);
  await logActivity("payment.link_sent", `${admin.name} emailed the payment link for ${invoice.number}`, { actorId: admin.id, entityType: "invoice", entityId: invoiceId });
  refreshSales(`/admin/invoices/${invoiceId}`, ...(invoice.orderId ? [`/admin/orders/${invoice.orderId}`] : []));
  return emailOutcome(r, "Payment link emailed to the customer.");
});

/* ================================================================ invoices */

const invoiceSchema = z.object({
  customerName: nameSchema,
  customerEmail: emailSchema,
  dueOn: z.string().trim().max(10).optional().nullable(),
  customerNotes: optText(5000),
  lines: z.array(lineSchema.omit({ sourceId: true, productId: true })).min(1, "Add at least one line.").max(MAX_LINES),
});

export const saveInvoiceDraftAction = permittedAction("finance", async (admin, invoiceIdArg: string, data: FormData) => {
  const invoiceId = idSchema.parse(invoiceIdArg);
  const input = invoiceSchema.parse(parsePayload(data));
  await saveInvoiceDraft(admin, invoiceId, { ...input, lines: input.lines as InvoiceLineInput[], dueDate: dayInput(input.dueOn, "dueOn") });
  refreshSales("/admin/invoices", `/admin/invoices/${invoiceId}`);
  return { ok: true, message: "Draft invoice saved." };
});

export const createCustomInvoiceAction = permittedAction("finance", async (admin, data: FormData) => {
  const payload = parsePayload(data) as Record<string, unknown>;
  const customerId = idSchema.parse(payload.customerId);
  const orderId = payload.orderId ? idSchema.parse(payload.orderId) : null;
  const input = invoiceSchema.omit({ customerName: true, customerEmail: true }).parse(payload);
  const invoice = await createCustomInvoice(admin, { customerId, orderId, lines: input.lines as InvoiceLineInput[], dueDate: dayInput(input.dueOn, "dueOn"), customerNotes: input.customerNotes });
  refreshSales("/admin/invoices");
  return { ok: true, id: invoice.id, message: `Draft invoice ${invoice.number} created.` };
});

export const sendInvoiceAction = permittedAction("finance", async (admin, invoiceIdArg: string) => {
  const invoiceId = idSchema.parse(invoiceIdArg);
  const r = await sendInvoice(admin, invoiceId);
  refreshSales("/admin/invoices", `/admin/invoices/${invoiceId}`);
  return emailOutcome(r.email, "Invoice sent — the customer was emailed a link to their invoice.");
});

export const resendInvoiceAction = permittedAction("finance", async (admin, invoiceIdArg: string, reminder: boolean) => {
  const invoiceId = idSchema.parse(invoiceIdArg);
  const r = await resendInvoice(admin, invoiceId, Boolean(reminder));
  refreshSales(`/admin/invoices/${invoiceId}`);
  return emailOutcome(r, reminder ? "Reminder sent." : "Invoice link sent again.");
});

/** Never deleted: voided with who/when/why. Paid invoices must be refunded first. */
export const voidInvoiceAction = permittedAction("finance", async (admin, invoiceIdArg: string, data: FormData) => {
  const invoiceId = idSchema.parse(invoiceIdArg);
  const reason = voidReasonText(fd.str(data, "reason"), fd.opt(data, "details"));
  await voidInvoice(admin, invoiceId, reason);
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { orderId: true } });
  refreshSales("/admin/invoices", `/admin/invoices/${invoiceId}`, ...(inv?.orderId ? [`/admin/orders/${inv.orderId}`] : []));
  return { ok: true, message: "Invoice voided — it stays in history but can no longer be paid." };
});

/* ================================================================ payments */

function paymentRefresh(invoiceId: string) {
  refreshSales("/admin/invoices", `/admin/invoices/${invoiceId}`, "/admin/payments", "/admin/orders");
}

/** Cash, check, bank transfer or other — recorded here, never created in Stripe. */
export const recordPaymentAction = permittedAction("finance", async (admin, invoiceIdArg: string, data: FormData) => {
  const invoiceId = idSchema.parse(invoiceIdArg);
  const amountCents = parseDollarsToCents(fd.str(data, "amount"));
  if (amountCents == null || Number.isNaN(amountCents)) throw new AdminError("Enter the amount received.", { amount: "Enter an amount." });
  const receivedAt = siteDateTime(`${fd.str(data, "receivedOn")}T12:00`);
  if (!receivedAt) throw new AdminError("Enter the date received.", { receivedOn: "Enter a date." });
  const method = fd.str(data, "method");
  const type = fd.opt(data, "type");
  const p = await recordManualPayment(admin, {
    invoiceId,
    amountCents,
    method,
    type: type || null,
    receivedAt,
    reference: fd.opt(data, "reference")?.slice(0, 120) ?? null,
    payerName: fd.opt(data, "payerName")?.slice(0, 120) ?? null,
    receivedBy: fd.opt(data, "receivedBy")?.slice(0, 120) ?? admin.name,
    notes: fd.opt(data, "notes")?.slice(0, 1000) ?? null,
    sendReceipt: fd.bool(data, "sendReceipt"),
    checkStatus: fd.str(data, "checkStatus") === "SUCCEEDED" ? "SUCCEEDED" : "PENDING",
    allowOverpayment: fd.bool(data, "allowOverpayment"),
  });
  paymentRefresh(invoiceId);
  return { ok: true, message: p.status === "PENDING" ? "Check recorded as pending — mark it cleared when it clears." : "Payment recorded." };
});

export const markCheckClearedAction = permittedAction("finance", async (admin, paymentIdArg: string) => {
  const paymentId = idSchema.parse(paymentIdArg);
  await markCheckCleared(admin, paymentId, true);
  refreshSales("/admin/invoices", "/admin/payments", "/admin/orders");
  return { ok: true, message: "Check marked cleared." };
});

export const markCheckReturnedAction = permittedAction("finance", async (admin, paymentIdArg: string, data: FormData) => {
  const reason = z.string().trim().min(3, "Give a short reason.").max(300).parse(fd.str(data, "reason"));
  await markCheckReturned(admin, idSchema.parse(paymentIdArg), reason);
  refreshSales("/admin/invoices", "/admin/payments", "/admin/orders");
  return { ok: true, message: "Check marked returned — it no longer counts toward the balance." };
});

export const voidPaymentAction = permittedAction("finance", async (admin, paymentIdArg: string, data: FormData) => {
  const reason = z.string().trim().min(3, "Give a short reason.").max(300).parse(fd.str(data, "reason"));
  await voidManualPayment(admin, idSchema.parse(paymentIdArg), reason);
  refreshSales("/admin/invoices", "/admin/payments", "/admin/orders");
  return { ok: true, message: "Payment voided (kept in the history). Record the correct amount if needed." };
});

export const recordRefundAction = permittedAction("finance", async (admin, paymentIdArg: string, data: FormData) => {
  const amountCents = parseDollarsToCents(fd.str(data, "amount"));
  if (amountCents == null || Number.isNaN(amountCents)) throw new AdminError("Enter the refund amount.", { amount: "Enter an amount." });
  const reason = z.string().trim().min(3, "Give a short reason.").max(300).parse(fd.str(data, "reason"));
  await recordRefund(admin, idSchema.parse(paymentIdArg), amountCents, reason);
  refreshSales("/admin/invoices", "/admin/payments", "/admin/orders");
  return { ok: true, message: "Refund recorded." };
});

/* ---------------------------------------------------------------- Stripe Terminal */

/** Send an in-person card payment to the reader. Recorded as pending until Stripe confirms it. */
export const startTerminalPaymentAction = permittedAction("finance", async (admin, invoiceIdArg: string, data: FormData) => {
  const invoiceId = idSchema.parse(invoiceIdArg);
  const raw = fd.str(data, "amount");
  const amountCents = raw ? parseDollarsToCents(raw) : null;
  if (raw && (amountCents == null || Number.isNaN(amountCents))) throw new AdminError("Enter a valid amount.", { amount: "Enter an amount." });
  await startTerminalPayment(admin, invoiceId, { amountCents, readerId: fd.opt(data, "readerId") });
  paymentRefresh(invoiceId);
  return { ok: true, message: "Sent to the reader — ask the customer to tap, insert or swipe their card. The payment is recorded once Stripe confirms it." };
});

export const refreshTerminalPaymentAction = permittedAction("finance", async (_admin, paymentIdArg: string) => {
  const p = await refreshTerminalPayment(idSchema.parse(paymentIdArg));
  if (p.invoiceId) paymentRefresh(p.invoiceId);
  return { ok: true, message: p.status === "SUCCEEDED" ? "Stripe confirmed the payment." : p.status === "FAILED" ? `The payment didn't go through${p.failureMessage ? `: ${p.failureMessage}` : ""}.` : `Still waiting on the reader${p.failureMessage ? ` (last attempt: ${p.failureMessage})` : ""}.` };
});

export const cancelTerminalPaymentAction = permittedAction("finance", async (admin, paymentIdArg: string) => {
  const paymentId = idSchema.parse(paymentIdArg);
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, select: { invoiceId: true } });
  await cancelTerminalPayment(admin, paymentId);
  if (p?.invoiceId) paymentRefresh(p.invoiceId);
  return { ok: true, message: "In-person payment canceled." };
});

/** Test mode only. */
export const simulateTerminalPaymentAction = permittedAction("finance", async (_admin, paymentIdArg: string) => {
  if (!terminalTestMode()) throw new AdminError("Simulated payments are only available with a Stripe test-mode key.");
  const p = await simulateTerminalPayment(idSchema.parse(paymentIdArg));
  if (p.invoiceId) paymentRefresh(p.invoiceId);
  return { ok: true, message: p.status === "SUCCEEDED" ? "Simulated card accepted — Stripe confirmed the payment." : "Simulated card presented; refresh in a moment." };
});

/** Owner/Admin: which reader in-person payments go to. */
export const setTerminalReaderAction = adminAction(async (admin, data: FormData) => {
  const readerId = fd.opt(data, "readerId");
  if (readerId && !/^tmr_[A-Za-z0-9]+$/.test(readerId)) throw new AdminError("Choose a reader.", { readerId: "Choose a reader." });
  await setTerminalReader(admin, readerId || null);
  revalidatePath("/admin/settings");
  revalidatePath("/admin", "layout");
  return { ok: true, message: readerId ? "Reader saved." : "Reader cleared." };
});

/* ================================================================ customers */

const customerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  zipCode: optText(10),
  billingAddress: optText(300),
  deliveryAddress: optText(300),
});

export const updateCustomerAction = permittedAction("sales", async (admin, customerIdArg: string, data: FormData) => {
  const customerId = idSchema.parse(customerIdArg);
  const input = customerSchema.parse({
    name: fd.str(data, "name"),
    email: fd.str(data, "email"),
    phone: fd.str(data, "phone"),
    zipCode: fd.str(data, "zipCode"),
    billingAddress: fd.str(data, "billingAddress"),
    deliveryAddress: fd.str(data, "deliveryAddress"),
  });
  await prisma.customer.update({ where: { id: customerId }, data: input });
  await logActivity("customer.updated", `${admin.name} updated customer ${input.name}`, { actorId: admin.id, entityType: "customer", entityId: customerId });
  refreshSales("/admin/customers", `/admin/customers/${customerId}`);
  return { ok: true, message: "Customer saved." };
});

const COMMUNICATION_TYPES = ["communication.call", "communication.email", "communication.meeting", "communication.note"] as const;

/** Log a phone call, email, visit or note on the customer timeline. */
export const logCommunicationAction = permittedAction("sales", async (admin, customerIdArg: string, data: FormData) => {
  const customerId = idSchema.parse(customerIdArg);
  const type = z.enum(COMMUNICATION_TYPES, { error: "Choose a type." }).parse(fd.str(data, "type"));
  const message = z.string().trim().min(2, "Write a short summary.").max(1000).parse(fd.str(data, "message"));
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true } });
  if (!customer) throw new AdminError("That customer no longer exists.");
  const quoteId = fd.opt(data, "quoteId");
  const orderId = fd.opt(data, "orderId");
  await recordCustomerActivity(prisma, {
    customerId,
    type,
    message,
    actorId: admin.id,
    quoteId: quoteId && (await prisma.quoteRequest.count({ where: { id: quoteId, customerId } })) ? quoteId : null,
    orderId: orderId && (await prisma.order.count({ where: { id: orderId, customerId } })) ? orderId : null,
  });
  await logActivity("customer.communication", `${admin.name} logged ${type.split(".")[1]} with ${customer.name}`, { actorId: admin.id, entityType: "customer", entityId: customerId });
  refreshSales(`/admin/customers/${customerId}`);
  return { ok: true, message: "Added to the timeline." };
});

/* ================================================================ email */

export const resendEmailAction = permittedAction("sales", async (admin, logIdArg: string) => {
  const logId = idSchema.parse(logIdArg);
  const r = await resendLoggedEmail(logId);
  await logActivity("email.resent", `${admin.name} resent an email (${r.status.toLowerCase()})`, { actorId: admin.id, entityType: "email", entityId: logId });
  refreshSales("/admin/quotes", "/admin/invoices", "/admin/orders");
  return r.status === "SENT" ? { ok: true, message: "Email sent." } : { ok: false, message: `The email failed again: ${r.error ?? "unknown error"}` };
});

const templateSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  heading: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10000),
  buttonLabel: optText(60),
  enabled: z.boolean(),
});

export const saveEmailTemplateAction = permittedAction("settings", async (admin, keyArg: string, data: FormData) => {
  if (!EMAIL_TEMPLATE_KEYS.includes(keyArg)) throw new AdminError("Unknown email template.");
  const input = templateSchema.parse({
    subject: fd.str(data, "subject"),
    heading: fd.str(data, "heading"),
    body: fd.str(data, "body"),
    buttonLabel: fd.str(data, "buttonLabel"),
    enabled: fd.bool(data, "enabled"),
  });
  const existing = await prisma.emailTemplate.findUnique({ where: { key: keyArg } });
  if (!existing) throw new AdminError("That template hasn't been created yet — redeploy to add it.");
  await prisma.emailTemplate.update({ where: { key: keyArg }, data: { ...input, updatedById: admin.id } });
  await logActivity("email_template.updated", `${admin.name} edited the "${existing.name}" email`, { actorId: admin.id, entityType: "email_template", entityId: keyArg });
  revalidatePath("/admin/settings/emails");
  return { ok: true, message: "Email template saved." };
});
