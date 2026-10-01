import "server-only";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { formatCents } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { closeOpenCheckout } from "./checkout";
import { SalesError } from "./errors";
import { invoiceMoney, recomputeInvoice } from "./ledger";
import type { Actor } from "./orders";
import { applyTerminalIntent, paymentTypeFor } from "./payments";
import { getInvoicingProvider, type TerminalReaderInfo } from "./stripe";

/*
 * In-person card payments on a Stripe Terminal smart reader (server-driven):
 *
 *   admin chooses the amount → we create a card_present PaymentIntent on the
 *   server → hand it to the selected reader → the customer taps/inserts →
 *   Stripe confirms (payment_intent.succeeded webhook, or a status check
 *   with Stripe) → the pending payment on the invoice becomes SUCCEEDED.
 *
 * Nothing is ever marked paid by the admin. The secret key stays on the
 * server; the browser only sees reader names and statuses.
 */

function provider() {
  const p = getInvoicingProvider();
  if (!p) throw new SalesError("Stripe isn't configured (STRIPE_SECRET_KEY), so in-person card payments aren't available.");
  return p;
}

/** Readers registered to this Stripe account, or an error message for the settings page. */
export async function listTerminalReaders(): Promise<{ readers: TerminalReaderInfo[]; error: string | null }> {
  const p = getInvoicingProvider();
  if (!p) return { readers: [], error: "Stripe isn't configured." };
  try {
    return { readers: await p.listTerminalReaders(), error: null };
  } catch (error) {
    logger.warn("Could not list Stripe Terminal readers", { error });
    return { readers: [], error: error instanceof Error ? error.message : "Couldn't reach Stripe." };
  }
}

/** Choose the reader in-person payments go to (must belong to this Stripe account). */
export async function setTerminalReader(actor: Actor, readerId: string | null) {
  if (readerId === null) {
    await prisma.siteSetting.update({ where: { id: "default" }, data: { terminalReaderId: null, terminalReaderLabel: null } });
    await logActivity("settings.terminal_reader", `${actor.name} cleared the Stripe Terminal reader`, { actorId: actor.id, entityType: "settings" });
    return;
  }
  const reader = await provider().retrieveTerminalReader(readerId).catch(() => null);
  if (!reader) throw new SalesError("That reader wasn't found in your Stripe account.");
  await prisma.siteSetting.update({ where: { id: "default" }, data: { terminalReaderId: reader.id, terminalReaderLabel: reader.label } });
  await logActivity("settings.terminal_reader", `${actor.name} set the Stripe Terminal reader to ${reader.label} (${reader.id})`, { actorId: actor.id, entityType: "settings" });
}

/**
 * Start an in-person card payment for (by default) the remaining balance. A
 * smaller partial amount is allowed; more than what's owed is not. The
 * payment is recorded as PENDING and only counts once Stripe confirms it.
 */
export async function startTerminalPayment(actor: Actor, invoiceId: string, input: { amountCents?: number | null; readerId?: string | null } = {}) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { order: { select: { id: true, number: true, productionStatus: true, quoteId: true } }, payments: { where: { method: "STRIPE_TERMINAL", status: "PENDING" }, select: { id: true } } } });
  if (!invoice) throw new SalesError("That invoice no longer exists.");
  if (["VOIDED", "CANCELED", "DRAFT"].includes(invoice.status)) throw new SalesError(invoice.status === "DRAFT" ? "Send the invoice first." : "This invoice is void.");
  if (invoice.order?.productionStatus === "CANCELED") throw new SalesError("This order is canceled.");
  if (invoice.payments.length) throw new SalesError("An in-person payment is already waiting on the reader. Check its status or cancel it first.");
  const money = invoiceMoney(invoice);
  const amount = input.amountCents ?? money.collectibleCents;
  if (!Number.isInteger(amount) || amount <= 0) throw new SalesError("Enter an amount greater than $0.", { amount: "Enter an amount." });
  if (amount > money.collectibleCents) throw new SalesError(`That's more than the ${formatCents(money.collectibleCents)} still owed.`, { amount: `At most ${formatCents(money.collectibleCents)}.` });
  const settings = await getSettings();
  const readerId = input.readerId || settings.terminalReaderId;
  if (!readerId) throw new SalesError("Choose a Stripe Terminal reader in Settings → Payments first.");
  const stripe = provider();
  await closeOpenCheckout(invoice.id);
  const type = paymentTypeFor(money, amount);

  // Record the attempt first so its id keys the PaymentIntent (retries never double-charge).
  const payment = await prisma.$transaction(async (tx) => {
    const row = await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        customerId: invoice.customerId,
        amountCents: amount,
        method: "STRIPE_TERMINAL",
        type,
        source: "STRIPE",
        status: "PENDING",
        receivedAt: new Date(),
        receivedBy: actor.name,
        recordedById: actor.id,
        stripeTerminalReaderId: readerId,
      },
    });
    await recomputeInvoice(tx, invoice.id);
    return row;
  });

  const fail = async (message: string) => {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureMessage: message.slice(0, 300) } });
      await recomputeInvoice(tx, invoice.id);
    });
    await logActivity("payment.terminal_failed", `In-person card payment of ${formatCents(amount)} on ${invoice.number} couldn't start: ${message}`.slice(0, 480), { actorId: actor.id, entityType: "payment", entityId: payment.id });
  };

  let intentId: string;
  try {
    const pi = await stripe.createTerminalPaymentIntent({
      idempotencyKey: `wm-terminal-${payment.id}`,
      amountCents: amount,
      description: `${type === "DEPOSIT" ? "Deposit" : "Payment"} — Wild Mountain Woodworks ${invoice.order ? `order ${invoice.order.number}` : `invoice ${invoice.number}`}`,
      metadata: {
        payment_id: payment.id,
        payment_type: type,
        expected_amount: String(amount),
        invoice_id: invoice.id,
        invoice_number: invoice.number,
        order_id: invoice.order?.id ?? "",
        order_number: invoice.order?.number ?? "",
        quote_id: invoice.order?.quoteId ?? "",
        customer_id: invoice.customerId ?? "",
      },
    });
    intentId = pi.id;
    await prisma.payment.update({ where: { id: payment.id }, data: { stripePaymentIntentId: pi.id } });
  } catch (error) {
    await fail(error instanceof Error ? error.message : "Stripe error");
    throw new SalesError(`Stripe couldn't start the payment: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  try {
    await stripe.processOnReader(readerId, intentId, `wm-terminal-process-${payment.id}`);
  } catch (error) {
    await stripe.cancelPaymentIntent(intentId).catch(() => undefined);
    await fail(error instanceof Error ? error.message : "Reader error");
    throw new SalesError(`The reader couldn't take the payment: ${error instanceof Error ? error.message : "unknown error"}. Check it's online and try again.`);
  }
  await logActivity("payment.terminal_started", `${actor.name} sent a ${formatCents(amount)} in-person card payment on ${invoice.number} to reader ${settings.terminalReaderLabel ?? readerId}`, { actorId: actor.id, entityType: "payment", entityId: payment.id });
  return prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
}

/** Ask Stripe for the latest on a pending in-person payment (the webhook does the same automatically). */
export async function refreshTerminalPayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.method !== "STRIPE_TERMINAL") throw new SalesError("That in-person payment no longer exists.");
  if (payment.status !== "PENDING" || !payment.stripePaymentIntentId) return payment;
  const stripe = provider();
  let pi = await stripe.retrievePaymentIntent(payment.stripePaymentIntentId);
  if (pi.status !== "succeeded" && pi.status !== "canceled" && payment.stripeTerminalReaderId) {
    // The reader reports declines/timeouts on its action.
    const reader = await stripe.retrieveTerminalReader(payment.stripeTerminalReaderId).catch(() => null);
    if (reader?.action?.paymentIntentId === pi.id && reader.action.status === "failed") {
      await stripe.cancelPaymentIntent(pi.id).catch(() => undefined);
      pi = { ...pi, status: "canceled", failureMessage: reader.action.failureMessage ?? "The reader couldn't complete the payment." };
    }
  }
  const followUps: Array<() => Promise<void>> = [];
  await prisma.$transaction((tx) => applyTerminalIntent(tx, pi, followUps));
  for (const f of followUps) await f().catch((error) => logger.error("Terminal follow-up failed", { error }));
  return prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
}

/** Stop a pending in-person payment (customer changed their mind, wrong amount…). If Stripe already approved it, it's recorded instead. */
export async function cancelTerminalPayment(actor: Actor, paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { invoice: { select: { number: true } } } });
  if (!payment || payment.method !== "STRIPE_TERMINAL") throw new SalesError("That in-person payment no longer exists.");
  if (payment.status !== "PENDING") throw new SalesError("This payment is no longer pending.");
  const stripe = provider();
  if (payment.stripeTerminalReaderId) await stripe.cancelReaderAction(payment.stripeTerminalReaderId).catch(() => undefined);
  if (payment.stripePaymentIntentId) {
    const pi = await stripe.retrievePaymentIntent(payment.stripePaymentIntentId);
    if (pi.status === "succeeded") {
      await refreshTerminalPayment(paymentId);
      throw new SalesError("Stripe had already approved this card payment, so it has been recorded instead of canceled.");
    }
    await stripe.cancelPaymentIntent(payment.stripePaymentIntentId).catch(() => undefined);
  }
  const followUps: Array<() => Promise<void>> = [];
  await prisma.$transaction((tx) =>
    applyTerminalIntent(tx, { id: payment.stripePaymentIntentId ?? "-", status: "canceled", failureMessage: `Canceled by ${actor.name}`, latestChargeId: null, amount: payment.amountCents }, followUps),
  );
  if (!payment.stripePaymentIntentId) await prisma.payment.update({ where: { id: paymentId }, data: { status: "FAILED", failureMessage: `Canceled by ${actor.name}` } });
  await logActivity("payment.terminal_canceled", `${actor.name} canceled the ${formatCents(payment.amountCents)} in-person card payment on ${payment.invoice?.number ?? "an invoice"}`, { actorId: actor.id, entityType: "payment", entityId: paymentId });
}

/** Test mode only: tap a test card on a simulated reader, then check the result. */
export async function simulateTerminalPayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment?.stripeTerminalReaderId || payment.status !== "PENDING") throw new SalesError("There's no pending in-person payment to simulate.");
  await provider().simulateReaderPayment(payment.stripeTerminalReaderId);
  return refreshTerminalPayment(paymentId);
}

/** Whether test helpers can be offered (test-mode key). */
export function terminalTestMode() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return key.startsWith("sk_test_") || key.startsWith("rk_test_");
}
