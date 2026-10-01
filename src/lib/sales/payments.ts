import "server-only";
import { Prisma, type PaymentType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { formatCents } from "@/lib/money";
import { adminRecipient, sendTemplateEmail } from "@/lib/email/send";
import { closeOpenCheckout } from "./checkout";
import { recordCustomerActivity } from "./customers";
import { SalesError } from "./errors";
import { invoiceMoney, netPaid, recomputeInvoice } from "./ledger";
import { adminLinks, customerLinks } from "./links";
import { notifyAutoConfirmed, type Actor } from "./orders";
import { MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABELS, PAYMENT_TYPES, PAYMENT_TYPE_LABELS, stripeMethodName, type ManualPaymentMethod } from "./status";
import { getInvoicingProvider, type PaymentIntentInfo, type StripeEvent } from "./stripe";

/*
 * Payments are always applied to a Wild Mountain Woodworks invoice. Every method has
 * its own record: Stripe online (Checkout) and Stripe Terminal payments come
 * only from Stripe's confirmation (verified webhook or a direct check with
 * Stripe); cash, checks and bank transfers are recorded by an admin and never
 * create anything in Stripe. Payments are never deleted — mistakes are voided
 * (with who, when, the original amount and why) and money returned is
 * recorded as a refund. No card data is ever stored.
 */

const ADMIN_ROLES_FOR_OVERPAYMENT = new Set(["OWNER"]);

/** What a payment is for, when the admin doesn't choose. */
export function paymentTypeFor(money: ReturnType<typeof invoiceMoney>, amountCents: number): PaymentType {
  if (amountCents >= money.collectibleCents && money.collectibleCents > 0) return "FINAL_BALANCE"; // settles everything left
  if (money.dueNowType === "DEPOSIT") return "DEPOSIT";
  return "PARTIAL_PAYMENT";
}

function paymentLink(invoice: { publicToken: string | null }, order: { customerToken: string | null } | null) {
  return invoice.publicToken ? customerLinks.invoice(invoice.publicToken) : order?.customerToken ? customerLinks.order(order.customerToken) : null;
}

/** Receipt for any settled payment; links to the Wild Mountain Woodworks invoice page. */
async function sendReceipt(paymentId: string) {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { invoice: true, order: true } });
  if (!p.invoice) return;
  const money = invoiceMoney(p.invoice);
  await sendTemplateEmail({
    template: "payment_received",
    to: p.invoice.customerEmail,
    vars: {
      customerName: p.invoice.customerName,
      invoiceNumber: p.invoice.number,
      orderNumber: p.order?.number,
      amountPaid: formatCents(p.amountCents),
      // "Affirm" / "Klarna" / "Card" when Stripe reported it.
      paymentMethod: stripeMethodName(p.stripePaymentMethodType) ?? PAYMENT_METHOD_LABELS[p.method],
      paymentFor: PAYMENT_TYPE_LABELS[p.type],
      balanceRemaining: formatCents(money.remainingCents),
    },
    actionUrl: paymentLink(p.invoice, p.order),
    links: { customerId: p.customerId, invoiceId: p.invoiceId, orderId: p.orderId },
  });
}

/** Confirmation after the deposit is paid right after acceptance (also confirms the order). */
async function sendDepositReceived(paymentId: string) {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { invoice: true, order: { include: { quote: { select: { number: true } } } } } });
  if (!p.invoice || !p.order) return sendReceipt(paymentId);
  const money = invoiceMoney(p.invoice);
  return sendTemplateEmail({
    template: "deposit_received",
    to: p.order.customerEmail,
    vars: {
      customerName: p.order.customerName,
      quoteNumber: p.order.quote?.number,
      orderNumber: p.order.number,
      amountPaid: formatCents(p.amountCents),
      balanceRemaining: formatCents(money.remainingCents),
    },
    actionUrl: p.order.customerToken ? customerLinks.order(p.order.customerToken) : null,
    links: { customerId: p.customerId, invoiceId: p.invoiceId, orderId: p.orderId, quoteId: p.order.quoteId },
  });
}

async function emailAdminPayment(invoice: { id: string; number: string; customerName: string; orderId: string | null }, amountCents: number, how: string) {
  const order = invoice.orderId ? await prisma.order.findUnique({ where: { id: invoice.orderId }, select: { number: true } }) : null;
  await sendTemplateEmail({
    template: "admin_payment_received",
    to: await adminRecipient(),
    vars: { customerName: invoice.customerName, invoiceNumber: invoice.number, orderNumber: order?.number, amountPaid: `${formatCents(amountCents)} (${how})` },
    actionUrl: adminLinks.invoice(invoice.id),
    links: { invoiceId: invoice.id, orderId: invoice.orderId },
  });
}

/** Email the customer the stable link to pay what's due (deposit or balance). */
export async function sendDepositPaymentRequest(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { order: true } });
  if (!invoice) throw new SalesError("That invoice no longer exists.");
  if (["VOIDED", "CANCELED", "DRAFT"].includes(invoice.status)) throw new SalesError("There's nothing to pay on this invoice.");
  const money = invoiceMoney(invoice);
  if (money.dueNowCents <= 0) throw new SalesError(money.remainingCents <= 0 ? "This invoice is already paid." : "Nothing is due yet — mark the balance due first.");
  if (money.dueNowType === "FINAL_BALANCE") {
    const { emailInvoiceLink } = await import("./invoices");
    return emailInvoiceLink(invoiceId, "balance_due");
  }
  return sendTemplateEmail({
    template: "deposit_payment_request",
    to: invoice.customerEmail,
    vars: { customerName: invoice.customerName, orderNumber: invoice.order?.number ?? invoice.number, amountDue: formatCents(money.dueNowCents) },
    actionUrl: invoice.order?.customerToken ? customerLinks.depositPay(invoice.order.customerToken) : invoice.publicToken ? customerLinks.invoicePay(invoice.publicToken) : null,
    links: { customerId: invoice.customerId, invoiceId: invoice.id, orderId: invoice.orderId, quoteId: invoice.quoteId },
  });
}

export interface ManualPaymentInput {
  invoiceId: string;
  amountCents: number;
  method: string;
  /** Defaults from the invoice (deposit / final balance / partial). */
  type?: string | null;
  receivedAt: Date;
  /** Check number, transfer reference… */
  reference: string | null;
  /** Bank / payer on a check. */
  payerName?: string | null;
  /** Who physically received it. */
  receivedBy?: string | null;
  notes: string | null;
  sendReceipt: boolean;
  /** Checks: PENDING until cleared (the default), or SUCCEEDED if already cleared. */
  checkStatus?: "PENDING" | "SUCCEEDED";
  /** Owner-only: accept more than the remaining balance. */
  allowOverpayment?: boolean;
}

/**
 * Record a cash / check / bank transfer / other payment against an invoice.
 * Never creates anything in Stripe. Capped at what's still owed (pending
 * payments included) unless an owner explicitly approves an overpayment.
 */
export async function recordManualPayment(actor: Actor & { role?: string }, input: ManualPaymentInput) {
  if (!(MANUAL_PAYMENT_METHODS as readonly string[]).includes(input.method)) throw new SalesError("Choose cash, check, bank transfer or other.", { method: "Invalid method." });
  const method = input.method as ManualPaymentMethod;
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new SalesError("Enter an amount greater than $0.", { amount: "Enter an amount." });
  if (input.type && !(PAYMENT_TYPES as readonly string[]).includes(input.type)) throw new SalesError("Choose what the payment is for.", { type: "Invalid purpose." });
  const invoice = await prisma.invoice.findUnique({ where: { id: input.invoiceId }, include: { order: { select: { productionStatus: true } } } });
  if (!invoice) throw new SalesError("That invoice no longer exists.");
  if (invoice.status === "VOIDED" || invoice.status === "CANCELED") throw new SalesError("This invoice is void.");
  if (invoice.order?.productionStatus === "CANCELED") throw new SalesError("This order is canceled — record refunds only.");
  if (input.receivedAt.getTime() > Date.now() + 86_400_000) throw new SalesError("The received date can't be in the future.", { receivedAt: "Can't be in the future." });
  const money = invoiceMoney(invoice);
  const over = input.amountCents > money.collectibleCents;
  if (over && !(input.allowOverpayment && ADMIN_ROLES_FOR_OVERPAYMENT.has(actor.role ?? ""))) {
    const pendingNote = money.pendingCents > 0 ? ` (${formatCents(money.pendingCents)} more is pending)` : "";
    throw new SalesError(`That's more than the ${formatCents(money.collectibleCents)} still owed on this invoice${pendingNote}.`, { amount: `At most ${formatCents(money.collectibleCents)}.` });
  }
  const type = (input.type as PaymentType | null | undefined) ?? paymentTypeFor(money, input.amountCents);
  const status = method === "CHECK" && (input.checkStatus ?? "PENDING") === "PENDING" ? "PENDING" : "SUCCEEDED";
  // Settling offline closes any open online checkout first, so it can't also be paid by card.
  await closeOpenCheckout(invoice.id);

  const { payment, autoConfirmed } = await prisma.$transaction(async (tx) => {
    const row = await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        customerId: invoice.customerId,
        amountCents: input.amountCents,
        method,
        type,
        source: "MANUAL",
        status,
        reference: input.reference,
        payerName: input.payerName ?? null,
        receivedBy: input.receivedBy ?? null,
        notes: input.notes,
        receivedAt: input.receivedAt,
        clearedAt: status === "SUCCEEDED" && method === "CHECK" ? new Date() : null,
        recordedById: actor.id,
        overpaymentApprovedById: over ? actor.id : null,
      },
    });
    // A payment on a draft means it was handled offline: issue it.
    if (invoice.status === "DRAFT") await tx.invoice.update({ where: { id: invoice.id }, data: { status: "OPEN", sentAt: new Date(), balanceDueAt: invoice.balanceDueAt ?? new Date() } });
    const r = await recomputeInvoice(tx, invoice.id);
    const label = `${formatCents(input.amountCents)} ${PAYMENT_METHOD_LABELS[method].toLowerCase()}${method === "CHECK" && input.reference ? ` #${input.reference}` : ""}`;
    await recordCustomerActivity(tx, {
      customerId: invoice.customerId,
      type: status === "PENDING" ? "payment.pending" : "payment.received",
      message: `${label} ${status === "PENDING" ? "received, pending until it clears" : "payment"} on ${invoice.number} (${PAYMENT_TYPE_LABELS[type].toLowerCase()})`,
      invoiceId: invoice.id,
      orderId: invoice.orderId,
      actorId: actor.id,
    });
    return { payment: row, autoConfirmed: r.autoConfirmed };
  });
  const what = method === "CHECK" ? `check${input.reference ? ` #${input.reference}` : ""} (${status === "PENDING" ? "pending" : "cleared"})` : PAYMENT_METHOD_LABELS[method].toLowerCase();
  await logActivity("payment.recorded", `${actor.name} recorded a ${formatCents(input.amountCents)} ${what} payment (${PAYMENT_TYPE_LABELS[type].toLowerCase()}) on invoice ${invoice.number}${input.receivedBy ? `, received by ${input.receivedBy}` : ""}`.slice(0, 480), { actorId: actor.id, entityType: "invoice", entityId: invoice.id });
  if (over) await logActivity("payment.overpayment_approved", `${actor.name} approved an overpayment of ${formatCents(input.amountCents - money.collectibleCents)} on invoice ${invoice.number}`, { actorId: actor.id, entityType: "invoice", entityId: invoice.id });
  if (input.sendReceipt && status === "SUCCEEDED") await sendReceipt(payment.id);
  if (autoConfirmed && invoice.orderId) await notifyAutoConfirmed(invoice.orderId, input.sendReceipt ? "send" : "suppressed", actor);
  return payment;
}

/** A pending check cleared: it now counts as paid. */
export async function markCheckCleared(actor: Actor, paymentId: string, sendReceiptEmail = false) {
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
  if (!p || p.method !== "CHECK") throw new SalesError("That check payment no longer exists.");
  if (p.status !== "PENDING") throw new SalesError("Only a pending check can be marked cleared.");
  const { autoConfirmed } = await prisma.$transaction(async (tx) => {
    const res = await tx.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status: "SUCCEEDED", clearedAt: new Date() } });
    if (!res.count) throw new SalesError("This check just changed. Reload the page.");
    const r = p.invoiceId ? await recomputeInvoice(tx, p.invoiceId) : { autoConfirmed: false };
    await recordCustomerActivity(tx, { customerId: p.customerId, type: "payment.received", message: `Check${p.reference ? ` #${p.reference}` : ""} for ${formatCents(p.amountCents)} cleared`, invoiceId: p.invoiceId, orderId: p.orderId, actorId: actor.id });
    return r;
  });
  await logActivity("payment.check_cleared", `${actor.name} marked check${p.reference ? ` #${p.reference}` : ""} (${formatCents(p.amountCents)}) cleared on ${p.invoice?.number ?? "an invoice"}`, { actorId: actor.id, entityType: "payment", entityId: paymentId });
  if (sendReceiptEmail) await sendReceipt(paymentId);
  if (autoConfirmed && p.orderId) await notifyAutoConfirmed(p.orderId, sendReceiptEmail ? "send" : "suppressed", actor);
}

/** A check bounced: it no longer counts, and the history keeps it as RETURNED. */
export async function markCheckReturned(actor: Actor, paymentId: string, reason: string) {
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
  if (!p || p.method !== "CHECK") throw new SalesError("That check payment no longer exists.");
  if (p.status !== "PENDING" && p.status !== "SUCCEEDED") throw new SalesError("Only a pending or cleared check can be marked returned.");
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: paymentId }, data: { status: "RETURNED", returnedAt: new Date(), voidReason: reason, voidedById: actor.id } });
    if (p.invoiceId) await recomputeInvoice(tx, p.invoiceId);
    await recordCustomerActivity(tx, { customerId: p.customerId, type: "payment.returned", message: `Check${p.reference ? ` #${p.reference}` : ""} for ${formatCents(p.amountCents)} was returned: ${reason}`, invoiceId: p.invoiceId, orderId: p.orderId, actorId: actor.id });
  });
  await logActivity("payment.check_returned", `${actor.name} marked check${p.reference ? ` #${p.reference}` : ""} (${formatCents(p.amountCents)}) returned on ${p.invoice?.number ?? "an invoice"}: ${reason}`, { actorId: actor.id, entityType: "payment", entityId: paymentId });
}

/**
 * Correct a mistaken manual entry: the payment is VOIDED (kept, with who,
 * when, the original amount and why) and no longer counts. Re-record the
 * right amount if needed. Stripe payments are corrected with refunds.
 */
export async function voidManualPayment(actor: Actor, paymentId: string, reason: string) {
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
  if (!p) throw new SalesError("That payment no longer exists.");
  if (p.source !== "MANUAL") throw new SalesError("Online and Terminal payments are managed in Stripe — record a refund instead.");
  if (p.status === "VOIDED") throw new SalesError("This payment is already voided.");
  if (p.refundedCents > 0) throw new SalesError("This payment has refunds recorded and can't be voided.");
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: paymentId }, data: { status: "VOIDED", voidedAt: new Date(), voidedById: actor.id, voidReason: reason } });
    if (p.invoiceId) await recomputeInvoice(tx, p.invoiceId);
    await recordCustomerActivity(tx, { customerId: p.customerId, type: "payment.voided", message: `${formatCents(p.amountCents)} payment voided: ${reason}`, invoiceId: p.invoiceId, orderId: p.orderId, actorId: actor.id });
  });
  await logActivity("payment.voided", `${actor.name} voided a ${formatCents(p.amountCents)} ${PAYMENT_METHOD_LABELS[p.method].toLowerCase()} payment (recorded ${p.receivedAt.toISOString().slice(0, 10)}) on ${p.invoice?.number ?? "an invoice"}. Reason: ${reason}`.slice(0, 480), { actorId: actor.id, entityType: "payment", entityId: paymentId });
}

/**
 * Record a refund against a payment. This is bookkeeping only: money is
 * returned outside the site (cash/check) or in the Stripe dashboard, whose
 * charge.refunded webhook also updates the record.
 */
export async function recordRefund(actor: Actor, paymentId: string, amountCents: number, reason: string) {
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
  if (!p) throw new SalesError("That payment no longer exists.");
  if (!["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(p.status)) throw new SalesError("Only successful payments can be refunded.");
  const refundable = p.amountCents - p.refundedCents;
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > refundable) throw new SalesError(`Enter an amount up to ${formatCents(refundable)}.`, { amount: `Up to ${formatCents(refundable)}.` });
  const refunded = p.refundedCents + amountCents;
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: paymentId }, data: { refundedCents: refunded, status: refunded >= p.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED", notes: [p.notes, `Refund ${formatCents(amountCents)}: ${reason}`].filter(Boolean).join("\n").slice(0, 2000) } });
    if (p.invoiceId) await recomputeInvoice(tx, p.invoiceId);
    await recordCustomerActivity(tx, { customerId: p.customerId, type: "payment.refunded", message: `Refund of ${formatCents(amountCents)} recorded: ${reason}`, invoiceId: p.invoiceId, orderId: p.orderId, actorId: actor.id });
  });
  await logActivity("payment.refunded", `${actor.name} recorded a ${formatCents(amountCents)} refund on ${p.invoice?.number ?? "a payment"}: ${reason}`, { actorId: actor.id, entityType: "payment", entityId: paymentId });
}

/* ------------------------------------------------------------ Stripe Terminal outcomes */

type Followups = Array<() => Promise<void>>;

/**
 * Apply Stripe's word on an in-person (Terminal) PaymentIntent to its pending
 * payment. Only PENDING payments move, so a repeated webhook or status check
 * never applies twice.
 */
export async function applyTerminalIntent(tx: Prisma.TransactionClient, pi: Pick<PaymentIntentInfo, "id" | "status" | "failureMessage" | "latestChargeId" | "amount">, followUps: Followups) {
  const payment = await tx.payment.findUnique({ where: { stripePaymentIntentId: pi.id }, include: { invoice: true } });
  if (!payment || payment.method !== "STRIPE_TERMINAL") return "ignored" as const;
  if (payment.status !== "PENDING") return "processed" as const;
  if (pi.status === "succeeded") {
    await tx.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED", stripeChargeId: pi.latestChargeId, receivedAt: new Date(), amountCents: pi.amount || payment.amountCents } });
    const r = payment.invoiceId ? await recomputeInvoice(tx, payment.invoiceId) : { autoConfirmed: false };
    await recordCustomerActivity(tx, { customerId: payment.customerId, type: "payment.received", message: `${formatCents(pi.amount || payment.amountCents)} paid by card in person on ${payment.invoice?.number ?? "an invoice"}`, invoiceId: payment.invoiceId, orderId: payment.orderId });
    followUps.push(async () => {
      await logActivity("payment.terminal_succeeded", `Stripe confirmed the ${formatCents(pi.amount || payment.amountCents)} in-person card payment on ${payment.invoice?.number ?? "an invoice"}`, { entityType: "payment", entityId: payment.id });
      await sendReceipt(payment.id);
      if (r.autoConfirmed && payment.orderId) await notifyAutoConfirmed(payment.orderId, "send", null);
    });
    return "processed" as const;
  }
  if (pi.status === "canceled" || pi.status === "failed") {
    const message = pi.failureMessage ?? (pi.status === "canceled" ? "Canceled" : "Payment failed");
    await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureMessage: message.slice(0, 300) } });
    if (payment.invoiceId) await recomputeInvoice(tx, payment.invoiceId);
    followUps.push(() => logActivity("payment.terminal_failed", `In-person card payment of ${formatCents(payment.amountCents)} on ${payment.invoice?.number ?? "an invoice"} did not go through: ${message}`.slice(0, 480), { entityType: "payment", entityId: payment.id }).then(() => undefined));
    return "processed" as const;
  }
  if (pi.failureMessage && pi.status === "requires_payment_method") {
    // Declined on the reader; the attempt stays open until it's retried or canceled.
    await tx.payment.update({ where: { id: payment.id }, data: { failureMessage: pi.failureMessage.slice(0, 300) } });
  }
  return "processed" as const;
}

/* ------------------------------------------------------------ Stripe webhooks */

type StripeInvoiceObject = {
  id: string;
  status?: string;
  amount_paid?: number;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  payment_intent?: string | { id: string } | null;
  charge?: string | { id: string } | null;
  metadata?: Record<string, string>;
  status_transitions?: { paid_at?: number | null };
};

type CheckoutSessionObject = {
  id: string;
  mode?: string;
  payment_status?: string;
  amount_total?: number | null;
  payment_intent?: string | { id: string } | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
  created?: number;
};

type PaymentIntentObject = {
  id: string;
  status?: string;
  amount?: number;
  amount_received?: number;
  latest_charge?: string | { id: string } | null;
  last_payment_error?: { message?: string } | null;
};

function idOf(v: string | { id: string } | null | undefined) {
  return typeof v === "string" ? v : (v?.id ?? null);
}

function typeFromMetadata(v: string | undefined): PaymentType {
  const t = (v ?? "").toUpperCase();
  // The whole order financed in one payment (Affirm/Klarna when eligible).
  if (t === "FULL_PURCHASE_FINANCING" || t === "FULL_PURCHASE") return "FULL_PURCHASE";
  return (PAYMENT_TYPES as readonly string[]).includes(t) ? (t as PaymentType) : "OTHER";
}

/** Best effort: note which Stripe method paid (card, affirm, klarna…) for the ledger and receipts. */
async function recordStripeMethodType(paymentId: string, intentId: string | null) {
  const provider = getInvoicingProvider();
  if (!provider || !intentId) return;
  try {
    const pi = await provider.retrievePaymentIntent(intentId);
    if (pi.paymentMethodType) await prisma.payment.update({ where: { id: paymentId }, data: { stripePaymentMethodType: pi.paymentMethodType.slice(0, 60) } });
  } catch (error) {
    logger.warn("Could not read the Stripe payment method type", { error, paymentId });
  }
}

async function findStripeInvoice(tx: Prisma.TransactionClient, obj: StripeInvoiceObject) {
  return tx.invoice.findFirst({ where: { OR: [{ stripeInvoiceId: obj.id }, ...(obj.metadata?.wmInvoiceId ? [{ id: obj.metadata.wmInvoiceId, stripeInvoiceId: null }] : [])] } });
}

/**
 * Apply a verified Stripe event. Idempotent: the event id is recorded in the
 * same transaction as its effects, so a redelivered event is a no-op, and
 * payments are keyed by Checkout Session and PaymentIntent. Stripe is the
 * source of truth for online and Terminal payment status — never a browser
 * redirect.
 */
export async function processStripeEvent(event: StripeEvent): Promise<"processed" | "duplicate" | "ignored"> {
  const followUps: Followups = [];
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });
      const obj = event.data.object as StripeInvoiceObject & { amount_refunded?: number };

      // Older invoices that were sent through Stripe Invoicing.
      if (event.type.startsWith("invoice.")) {
        const invoice = await findStripeInvoice(tx, obj);
        if (!invoice) return "ignored" as const;
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            stripeInvoiceId: obj.id,
            stripeStatus: obj.status ?? invoice.stripeStatus,
            stripeHostedInvoiceUrl: obj.hosted_invoice_url ?? invoice.stripeHostedInvoiceUrl,
            stripeInvoicePdfUrl: obj.invoice_pdf ?? invoice.stripeInvoicePdfUrl,
          },
        });
        if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
          const stripePaid = obj.amount_paid ?? 0;
          const existing = await tx.payment.findMany({ where: { invoiceId: invoice.id, source: "STRIPE", stripeInvoiceId: obj.id } });
          const recorded = existing.reduce((s, p) => s + p.amountCents, 0);
          const delta = stripePaid - recorded;
          const intentId = idOf(obj.payment_intent);
          if (delta > 0 && !(intentId && existing.some((p) => p.stripePaymentIntentId === intentId))) {
            const payment = await tx.payment.create({
              data: {
                invoiceId: invoice.id,
                orderId: invoice.orderId,
                customerId: invoice.customerId,
                amountCents: delta,
                method: "STRIPE_ONLINE",
                type: invoice.kind === "DEPOSIT" ? "DEPOSIT" : invoice.kind === "BALANCE" ? "FINAL_BALANCE" : "OTHER",
                source: "STRIPE",
                status: "SUCCEEDED",
                stripePaymentIntentId: intentId,
                stripeChargeId: idOf(obj.charge),
                stripeInvoiceId: obj.id,
                receivedAt: obj.status_transitions?.paid_at ? new Date(obj.status_transitions.paid_at * 1000) : new Date(),
              },
            });
            await recordCustomerActivity(tx, { customerId: invoice.customerId, type: "payment.received", message: `${formatCents(delta)} paid online for ${invoice.number}`, invoiceId: invoice.id, orderId: invoice.orderId });
            followUps.push(async () => {
              await logActivity("payment.recorded", `Stripe payment of ${formatCents(delta)} received for invoice ${invoice.number}`, { entityType: "invoice", entityId: invoice.id });
              await sendReceipt(payment.id);
              await emailAdminPayment(invoice, delta, "Stripe online");
            });
          }
          await recomputeInvoice(tx, invoice.id);
        } else if (event.type === "invoice.payment_failed") {
          await recordCustomerActivity(tx, { customerId: invoice.customerId, type: "payment.failed", message: `An online payment attempt for ${invoice.number} failed`, invoiceId: invoice.id, orderId: invoice.orderId });
        } else if (event.type === "invoice.voided" || event.type === "invoice.marked_uncollectible") {
          if (invoice.amountPaidCents === 0 && invoice.status !== "VOIDED") {
            await tx.invoice.update({ where: { id: invoice.id }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: `Stripe: ${event.type}`, statusEvents: { create: { fromStatus: invoice.status, toStatus: "VOIDED" } } } });
          }
        } else {
          await recomputeInvoice(tx, invoice.id);
        }
        return "processed" as const;
      }

      // Online payments: deposit and final balance through Stripe Checkout.
      if (event.type.startsWith("checkout.session.")) {
        const session = event.data.object as CheckoutSessionObject;
        if (session.mode && session.mode !== "payment") return "ignored" as const;
        const invoiceId = session.metadata?.invoice_id ?? session.client_reference_id ?? null;
        const invoice = invoiceId ? await tx.invoice.findUnique({ where: { id: invoiceId } }) : await tx.invoice.findFirst({ where: { stripeCheckoutSessionId: session.id } });
        if (!invoice) return "ignored" as const;
        const isCurrent = invoice.stripeCheckoutSessionId === session.id;
        const type = typeFromMetadata(session.metadata?.payment_type);

        const paidNow = (event.type === "checkout.session.completed" && session.payment_status === "paid") || event.type === "checkout.session.async_payment_succeeded";
        if (paidNow) {
          const amount = session.amount_total ?? 0;
          const intentId = idOf(session.payment_intent);
          // One payment per Checkout Session / PaymentIntent, however often Stripe retries.
          const already = await tx.payment.findFirst({ where: { OR: [{ stripeCheckoutSessionId: session.id }, ...(intentId ? [{ stripePaymentIntentId: intentId }] : [])] } });
          if (!already && amount > 0) {
            const owedBefore = invoice.totalCents - invoice.amountPaidCents;
            const payment = await tx.payment.create({
              data: {
                invoiceId: invoice.id,
                orderId: invoice.orderId,
                customerId: invoice.customerId,
                amountCents: amount,
                method: "STRIPE_ONLINE",
                type,
                source: "STRIPE",
                status: "SUCCEEDED",
                stripePaymentIntentId: intentId,
                stripeCheckoutSessionId: session.id,
                receivedAt: session.created ? new Date(session.created * 1000) : new Date(),
                notes: amount > owedBefore ? `Received ${formatCents(amount - Math.max(0, owedBefore))} more than was due — review for a refund.` : null,
              },
            });
            await tx.invoice.update({ where: { id: invoice.id }, data: { stripeCheckoutStatus: "complete" } });
            await recordCustomerActivity(tx, { customerId: invoice.customerId, type: "payment.received", message: `${formatCents(amount)} ${PAYMENT_TYPE_LABELS[type].toLowerCase()} paid online for ${invoice.number}`, invoiceId: invoice.id, orderId: invoice.orderId });
            const r = await recomputeInvoice(tx, invoice.id);
            followUps.push(async () => {
              await recordStripeMethodType(payment.id, intentId);
              await logActivity("payment.recorded", `Stripe Checkout payment of ${formatCents(amount)} (${PAYMENT_TYPE_LABELS[type].toLowerCase()}${type === "FULL_PURCHASE" ? " — financed/paid in full" : ""}) received for invoice ${invoice.number}`, { entityType: "invoice", entityId: invoice.id });
              if (type === "DEPOSIT") await sendDepositReceived(payment.id);
              else await sendReceipt(payment.id);
              // The deposit confirmation already tells the customer their order is confirmed.
              if (r.autoConfirmed && invoice.orderId) await notifyAutoConfirmed(invoice.orderId, type === "DEPOSIT" ? "covered" : "send", null);
              await emailAdminPayment(invoice, amount, "Stripe online");
            });
          }
          return "processed" as const;
        }
        if (event.type === "checkout.session.completed") {
          // e.g. a bank debit still clearing: wait for async_payment_succeeded.
          if (isCurrent) await tx.invoice.update({ where: { id: invoice.id }, data: { stripeCheckoutStatus: "processing" } });
          return "processed" as const;
        }
        if (event.type === "checkout.session.async_payment_failed") {
          if (isCurrent) await tx.invoice.update({ where: { id: invoice.id }, data: { stripeCheckoutStatus: "failed" } });
          await recordCustomerActivity(tx, { customerId: invoice.customerId, type: "payment.failed", message: `An online payment for ${invoice.number} failed`, invoiceId: invoice.id, orderId: invoice.orderId });
          return "processed" as const;
        }
        if (event.type === "checkout.session.expired") {
          if (isCurrent) {
            await tx.invoice.update({ where: { id: invoice.id }, data: { stripeCheckoutStatus: "expired" } });
            // Abandoned deposit: one friendly email with the payment link (never repeated).
            const money = invoiceMoney(invoice);
            if (money.dueNowType === "DEPOSIT" && !["VOIDED", "CANCELED"].includes(invoice.status) && !(await tx.emailLog.findFirst({ where: { invoiceId: invoice.id, template: "deposit_payment_request" } }))) {
              followUps.push(() => sendDepositPaymentRequest(invoice.id).then(() => undefined));
            }
          }
          return "processed" as const;
        }
        return "ignored" as const;
      }

      // In-person payments on a Stripe Terminal reader.
      if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
        const pi = event.data.object as PaymentIntentObject;
        return applyTerminalIntent(
          tx,
          {
            id: pi.id,
            status: event.type === "payment_intent.payment_failed" ? "failed" : (pi.status ?? (event.type === "payment_intent.succeeded" ? "succeeded" : "canceled")),
            amount: pi.amount_received || pi.amount || 0,
            failureMessage: pi.last_payment_error?.message ?? null,
            latestChargeId: idOf(pi.latest_charge),
          },
          followUps,
        );
      }

      if (event.type === "charge.refunded") {
        const intentId = idOf(obj.payment_intent);
        const payment = intentId ? await tx.payment.findUnique({ where: { stripePaymentIntentId: intentId } }) : null;
        if (!payment) return "ignored" as const;
        const refunded = Math.min(payment.amountCents, obj.amount_refunded ?? 0);
        await tx.payment.update({ where: { id: payment.id }, data: { refundedCents: refunded, status: refunded >= payment.amountCents ? "REFUNDED" : refunded > 0 ? "PARTIALLY_REFUNDED" : payment.status } });
        if (payment.invoiceId) await recomputeInvoice(tx, payment.invoiceId);
        await recordCustomerActivity(tx, { customerId: payment.customerId, type: "payment.refunded", message: `Stripe refund: ${formatCents(refunded)} of ${formatCents(payment.amountCents)}`, invoiceId: payment.invoiceId, orderId: payment.orderId });
        return "processed" as const;
      }
      return "ignored" as const;
    });
    for (const f of followUps) await f().catch((error) => logger.error("Stripe follow-up failed", { error }));
    return outcome;
  } catch (error) {
    // Unique violation on StripeEvent.id (event already processed) or on
    // Payment.stripePaymentIntentId (payment already recorded).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "duplicate";
    throw error;
  }
}

/** Settled money across an order's payments (for summaries). */
export function settledTotal(payments: Array<{ amountCents: number; refundedCents: number; status: string }>) {
  return payments.reduce((s, p) => s + netPaid(p), 0);
}
