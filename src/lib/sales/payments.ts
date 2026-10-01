import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { formatCents } from "@/lib/money";
import { adminRecipient, sendTemplateEmail } from "@/lib/email/send";
import { closeOpenCheckout } from "./checkout";
import { recordCustomerActivity } from "./customers";
import { SalesError } from "./errors";
import { netPaid, recomputeInvoice } from "./ledger";
import { adminLinks, customerLinks } from "./links";
import type { Actor } from "./orders";
import { MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type ManualPaymentMethod } from "./status";
import type { StripeEvent } from "./stripe";

async function sendReceipt(paymentId: string) {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { invoice: true, order: true } });
  if (!p.invoice) return;
  const orderBalance = p.order ? p.order.totalCents - (await prisma.payment.findMany({ where: { orderId: p.order.id } })).reduce((s, x) => s + netPaid(x), 0) : null;
  await sendTemplateEmail({
    template: "payment_received",
    to: p.invoice.customerEmail,
    vars: {
      customerName: p.invoice.customerName,
      invoiceNumber: p.invoice.number,
      orderNumber: p.order?.number,
      amountPaid: formatCents(p.amountCents),
      paymentMethod: PAYMENT_METHOD_LABELS[p.method],
      balanceRemaining: formatCents(Math.max(0, orderBalance ?? p.invoice.totalCents - p.invoice.amountPaidCents)),
    },
    actionUrl: p.order?.customerToken ? customerLinks.order(p.order.customerToken) : p.invoice.publicToken ? customerLinks.invoice(p.invoice.publicToken) : null,
    links: { customerId: p.customerId, invoiceId: p.invoiceId, orderId: p.orderId },
  });
}

/** Confirmation after the deposit is paid (replaces "we'll send an invoice"). */
async function sendDepositReceived(paymentId: string) {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { invoice: true, order: { include: { quote: { select: { number: true } }, payments: true } } } });
  if (!p.invoice || !p.order) return sendReceipt(paymentId);
  const paid = p.order.payments.reduce((s, x) => s + netPaid(x), 0);
  await sendTemplateEmail({
    template: "deposit_received",
    to: p.order.customerEmail,
    vars: {
      customerName: p.order.customerName,
      quoteNumber: p.order.quote?.number,
      orderNumber: p.order.number,
      amountPaid: formatCents(p.amountCents),
      balanceRemaining: formatCents(Math.max(0, p.order.totalCents - paid)),
    },
    actionUrl: p.order.customerToken ? customerLinks.order(p.order.customerToken) : null,
    links: { customerId: p.customerId, invoiceId: p.invoiceId, orderId: p.orderId, quoteId: p.order.quoteId },
  });
}

/** Email the customer the stable deposit payment link (/order/<token>/pay). */
export async function sendDepositPaymentRequest(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { order: true } });
  if (!invoice?.order?.customerToken) throw new SalesError("This deposit isn't linked to an order.");
  if (invoice.totalCents - invoice.amountPaidCents <= 0) throw new SalesError("This deposit is already paid.");
  return sendTemplateEmail({
    template: "deposit_payment_request",
    to: invoice.order.customerEmail,
    vars: { customerName: invoice.order.customerName, orderNumber: invoice.order.number, amountDue: formatCents(invoice.totalCents - invoice.amountPaidCents) },
    actionUrl: customerLinks.depositPay(invoice.order.customerToken),
    links: { customerId: invoice.customerId, invoiceId: invoice.id, orderId: invoice.orderId, quoteId: invoice.quoteId },
  });
}

/**
 * Record a cash / check / bank transfer payment against an invoice. Never
 * creates anything in Stripe. Amount is capped at what's still owed.
 */
export async function recordManualPayment(
  actor: Actor,
  input: { invoiceId: string; amountCents: number; method: string; receivedAt: Date; reference: string | null; notes: string | null; sendReceipt: boolean },
) {
  if (!(MANUAL_PAYMENT_METHODS as readonly string[]).includes(input.method)) throw new SalesError("Choose cash, check, bank transfer or other.", { method: "Invalid method." });
  const method = input.method as ManualPaymentMethod;
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new SalesError("Enter an amount greater than $0.", { amount: "Enter an amount." });
  const invoice = await prisma.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!invoice) throw new SalesError("That invoice no longer exists.");
  if (invoice.status === "VOID" || invoice.status === "CANCELED") throw new SalesError("This invoice is void.");
  const owed = invoice.totalCents - invoice.amountPaidCents;
  if (input.amountCents > owed) throw new SalesError(`That's more than the ${formatCents(owed)} still owed on this invoice.`, { amount: `At most ${formatCents(owed)}.` });
  if (input.receivedAt.getTime() > Date.now() + 86_400_000) throw new SalesError("The received date can't be in the future.", { receivedAt: "Can't be in the future." });
  // Settling a deposit offline closes its online checkout first, so it can't also be paid by card.
  await closeOpenCheckout(invoice.id);

  const payment = await prisma.$transaction(async (tx) => {
    const row = await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        customerId: invoice.customerId,
        amountCents: input.amountCents,
        method,
        source: "MANUAL",
        status: "SUCCEEDED",
        reference: input.reference,
        notes: input.notes,
        receivedAt: input.receivedAt,
        recordedById: actor.id,
      },
    });
    // A manual payment on a draft means it was handled offline: treat it as sent.
    if (invoice.status === "DRAFT") await tx.invoice.update({ where: { id: invoice.id }, data: { status: "SENT", sentAt: new Date() } });
    await recomputeInvoice(tx, invoice.id);
    await recordCustomerActivity(tx, { customerId: invoice.customerId, type: "payment.received", message: `${formatCents(input.amountCents)} ${PAYMENT_METHOD_LABELS[method]} payment on ${invoice.number}`, invoiceId: invoice.id, orderId: invoice.orderId, actorId: actor.id });
    return row;
  });
  await logActivity("payment.recorded", `${actor.name} recorded a ${formatCents(input.amountCents)} ${PAYMENT_METHOD_LABELS[method]} payment on invoice ${invoice.number}`, { actorId: actor.id, entityType: "invoice", entityId: invoice.id });
  if (input.sendReceipt) await sendReceipt(payment.id);
  return payment;
}

/** Void a mistaken manual payment (kept for the record, never deleted). Stripe payments can't be voided here. */
export async function voidManualPayment(actor: Actor, paymentId: string, reason: string) {
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
  if (!p) throw new SalesError("That payment no longer exists.");
  if (p.source !== "MANUAL") throw new SalesError("Online payments are managed in Stripe — record a refund instead.");
  if (p.status === "VOIDED") throw new SalesError("This payment is already voided.");
  if (p.refundedCents > 0) throw new SalesError("This payment has refunds recorded and can't be voided.");
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: paymentId }, data: { status: "VOIDED", voidedAt: new Date(), voidedById: actor.id, voidReason: reason } });
    if (p.invoiceId) await recomputeInvoice(tx, p.invoiceId);
    await recordCustomerActivity(tx, { customerId: p.customerId, type: "payment.voided", message: `${formatCents(p.amountCents)} payment voided: ${reason}`, invoiceId: p.invoiceId, orderId: p.orderId, actorId: actor.id });
  });
  await logActivity("payment.voided", `${actor.name} voided a ${formatCents(p.amountCents)} payment on ${p.invoice?.number ?? "an invoice"}: ${reason}`, { actorId: actor.id, entityType: "payment", entityId: paymentId });
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

function idOf(v: string | { id: string } | null | undefined) {
  return typeof v === "string" ? v : (v?.id ?? null);
}

async function findInvoice(tx: Prisma.TransactionClient, obj: StripeInvoiceObject) {
  return tx.invoice.findFirst({ where: { OR: [{ stripeInvoiceId: obj.id }, ...(obj.metadata?.wmInvoiceId ? [{ id: obj.metadata.wmInvoiceId, stripeInvoiceId: null }] : [])] } });
}

/**
 * Apply a verified Stripe event. Idempotent: the event id is recorded in the
 * same transaction as its effects, so a redelivered event is a no-op, and
 * payments are keyed by PaymentIntent. Stripe (via the webhook) is the source
 * of truth for online payment status — never a browser redirect.
 */
export async function processStripeEvent(event: StripeEvent): Promise<"processed" | "duplicate" | "ignored"> {
  const followUps: Array<() => Promise<void>> = [];
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });
      const obj = event.data.object as StripeInvoiceObject & { amount_refunded?: number };

      if (event.type.startsWith("invoice.")) {
        const invoice = await findInvoice(tx, obj);
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
          const existing = await tx.payment.findMany({ where: { invoiceId: invoice.id, source: "STRIPE" } });
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
                method: "STRIPE",
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
              const order = invoice.orderId ? await prisma.order.findUnique({ where: { id: invoice.orderId }, select: { number: true } }) : null;
              await sendTemplateEmail({
                template: "admin_payment_received",
                to: await adminRecipient(),
                vars: { customerName: invoice.customerName, invoiceNumber: invoice.number, orderNumber: order?.number, amountPaid: formatCents(delta) },
                actionUrl: adminLinks.invoice(invoice.id),
                links: { invoiceId: invoice.id, orderId: invoice.orderId },
              });
            });
          }
          await recomputeInvoice(tx, invoice.id);
        } else if (event.type === "invoice.payment_failed") {
          await recordCustomerActivity(tx, { customerId: invoice.customerId, type: "payment.failed", message: `An online payment attempt for ${invoice.number} failed`, invoiceId: invoice.id, orderId: invoice.orderId });
        } else if (event.type === "invoice.voided" || event.type === "invoice.marked_uncollectible") {
          if (invoice.amountPaidCents === 0 && invoice.status !== "VOID") {
            await tx.invoice.update({ where: { id: invoice.id }, data: { status: "VOID", voidedAt: new Date(), voidReason: `Stripe: ${event.type}`, statusEvents: { create: { fromStatus: invoice.status, toStatus: "VOID" } } } });
          }
        } else {
          await recomputeInvoice(tx, invoice.id);
        }
        return "processed" as const;
      }

      if (event.type.startsWith("checkout.session.")) {
        const session = event.data.object as CheckoutSessionObject;
        if (session.mode && session.mode !== "payment") return "ignored" as const;
        const invoiceId = session.metadata?.invoice_id ?? session.client_reference_id ?? null;
        const invoice = invoiceId ? await tx.invoice.findUnique({ where: { id: invoiceId } }) : await tx.invoice.findFirst({ where: { stripeCheckoutSessionId: session.id } });
        if (!invoice) return "ignored" as const;
        const isCurrent = invoice.stripeCheckoutSessionId === session.id;

        const paidNow =
          (event.type === "checkout.session.completed" && session.payment_status === "paid") || event.type === "checkout.session.async_payment_succeeded";
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
                method: "STRIPE",
                source: "STRIPE",
                status: "SUCCEEDED",
                stripePaymentIntentId: intentId,
                stripeCheckoutSessionId: session.id,
                receivedAt: session.created ? new Date(session.created * 1000) : new Date(),
                notes: amount > owedBefore ? `Received ${formatCents(amount - Math.max(0, owedBefore))} more than was due — review for a refund.` : null,
              },
            });
            await tx.invoice.update({ where: { id: invoice.id }, data: { stripeCheckoutStatus: "complete" } });
            await recordCustomerActivity(tx, { customerId: invoice.customerId, type: "payment.received", message: `${formatCents(amount)} ${invoice.kind === "DEPOSIT" ? "deposit " : ""}paid online for ${invoice.number}`, invoiceId: invoice.id, orderId: invoice.orderId });
            await recomputeInvoice(tx, invoice.id);
            followUps.push(async () => {
              await logActivity("payment.recorded", `Stripe Checkout payment of ${formatCents(amount)} received for invoice ${invoice.number}`, { entityType: "invoice", entityId: invoice.id });
              if (invoice.kind === "DEPOSIT") await sendDepositReceived(payment.id);
              else await sendReceipt(payment.id);
              const order = invoice.orderId ? await prisma.order.findUnique({ where: { id: invoice.orderId }, select: { number: true } }) : null;
              await sendTemplateEmail({
                template: "admin_payment_received",
                to: await adminRecipient(),
                vars: { customerName: invoice.customerName, invoiceNumber: invoice.number, orderNumber: order?.number, amountPaid: formatCents(amount) },
                actionUrl: adminLinks.invoice(invoice.id),
                links: { invoiceId: invoice.id, orderId: invoice.orderId },
              });
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
            const stillDue = invoice.kind === "DEPOSIT" && invoice.totalCents > invoice.amountPaidCents && !["VOID", "CANCELED", "PAID"].includes(invoice.status);
            if (stillDue && !(await tx.emailLog.findFirst({ where: { invoiceId: invoice.id, template: "deposit_payment_request" } }))) {
              followUps.push(() => sendDepositPaymentRequest(invoice.id).then(() => undefined));
            }
          }
          return "processed" as const;
        }
        return "ignored" as const;
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
