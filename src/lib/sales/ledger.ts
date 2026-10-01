import "server-only";
import type { InvoiceStatus, OrderPaymentStatus, PaymentType, Prisma, ProductionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient;

/**
 * Money state is always DERIVED from Payment records — never typed in and
 * never trusted from a browser. One invoice per order carries the whole
 * accepted total; every payment (deposit, final balance, cash, check,
 * Terminal…) is applied to it:
 *
 *   remaining = invoice total − settled payments
 *
 * Pending payments (a check waiting to clear, a card on the Terminal reader)
 * are shown and held against the balance so nothing is collected twice, but
 * they don't count as paid until they settle.
 */

/** Net money kept from a payment (after refunds). Pending/failed/voided/returned count as 0. */
export function netPaid(p: { amountCents: number; refundedCents: number; status: string }): number {
  if (p.status === "SUCCEEDED" || p.status === "PARTIALLY_REFUNDED" || p.status === "REFUNDED") return Math.max(0, p.amountCents - p.refundedCents);
  return 0;
}

/** Money in flight (counts against the balance for new payments, but not as paid). */
export function pendingAmount(p: { amountCents: number; status: string }): number {
  return p.status === "PENDING" ? p.amountCents : 0;
}

type InvoiceMoneyInput = { status: InvoiceStatus; totalCents: number; depositCents: number; balanceDueAt: Date | null };

/**
 * DEPOSIT_DUE → (deposit paid) PARTIALLY_PAID → (admin: Mark balance due)
 * BALANCE_DUE → PAID. Drafts, voided and canceled invoices keep their status.
 */
export function invoiceStatusFor(inv: InvoiceMoneyInput, paidCents: number): InvoiceStatus {
  if (inv.status === "VOIDED" || inv.status === "CANCELED" || inv.status === "DRAFT") return inv.status;
  if (inv.totalCents > 0 && paidCents >= inv.totalCents) return "PAID";
  if (inv.balanceDueAt) return "BALANCE_DUE";
  if (inv.depositCents > 0 && paidCents < inv.depositCents) return "DEPOSIT_DUE";
  if (paidCents > 0) return "PARTIALLY_PAID";
  return "OPEN";
}

export interface InvoiceMoney {
  totalCents: number;
  depositCents: number;
  paidCents: number;
  pendingCents: number;
  /** Total minus settled payments. */
  remainingCents: number;
  /** Most that can still be recorded/collected without overpaying (remaining minus pending). */
  collectibleCents: number;
  /** What the customer is asked to pay right now, and what for (0 = nothing requested yet). */
  dueNowCents: number;
  dueNowType: Extract<PaymentType, "DEPOSIT" | "FINAL_BALANCE"> | null;
}

export function invoiceMoney(inv: InvoiceMoneyInput & { amountPaidCents: number; pendingCents: number }): InvoiceMoney {
  const paid = inv.amountPaidCents;
  const pending = inv.pendingCents;
  const remaining = Math.max(0, inv.totalCents - paid);
  const collectible = Math.max(0, remaining - pending);
  const status = invoiceStatusFor(inv, paid);
  let dueNow = 0;
  let dueNowType: InvoiceMoney["dueNowType"] = null;
  if (status === "BALANCE_DUE") {
    dueNow = collectible;
    dueNowType = "FINAL_BALANCE";
  } else if (status === "DEPOSIT_DUE") {
    dueNow = Math.min(collectible, Math.max(0, inv.depositCents - paid - pending));
    dueNowType = "DEPOSIT";
  }
  if (dueNow <= 0) dueNowType = null;
  return { totalCents: inv.totalCents, depositCents: inv.depositCents, paidCents: paid, pendingCents: pending, remainingCents: remaining, collectibleCents: collectible, dueNowCents: Math.max(0, dueNow), dueNowType };
}

export async function recomputeInvoice(db: Db, invoiceId: string, now = new Date()) {
  const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payments: true } });
  const paid = invoice.payments.reduce((s, p) => s + netPaid(p), 0);
  const pending = invoice.payments.reduce((s, p) => s + pendingAmount(p), 0);
  const status = invoiceStatusFor(invoice, paid);
  const becamePaid = status === "PAID" && invoice.status !== "PAID";
  const updated = await db.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaidCents: paid,
      pendingCents: pending,
      status,
      paidAt: status === "PAID" ? (invoice.paidAt ?? now) : null,
      ...(status !== invoice.status ? { statusEvents: { create: { fromStatus: invoice.status, toStatus: status } } } : {}),
    },
  });
  const order = updated.orderId ? await recomputeOrderPayment(db, updated.orderId, now) : null;
  return { invoice: updated, becamePaid, autoConfirmed: order?.autoConfirmed ?? false };
}

export function orderPaymentStatusFor(
  o: { productionStatus: ProductionStatus; totalCents: number; depositCents: number },
  paidCents: number,
  refundedAny: boolean,
  balanceRequested: boolean,
): OrderPaymentStatus {
  if (o.productionStatus === "CANCELED" && paidCents === 0) return refundedAny ? "REFUNDED" : "CANCELED";
  if (refundedAny && paidCents === 0) return "REFUNDED";
  if (o.totalCents > 0 && paidCents >= o.totalCents) return "PAID";
  if (balanceRequested) return "BALANCE_DUE";
  if (o.depositCents > 0 && paidCents < o.depositCents) return "DEPOSIT_DUE";
  if (paidCents > 0) return "PARTIALLY_PAID";
  return "UNPAID";
}

/**
 * Recompute an order's payment status from its payments. Production status
 * stays separate, with one automatic step: once the deposit is covered (or
 * none is required), AWAITING_DEPOSIT becomes ORDER_CONFIRMED.
 */
export async function recomputeOrderPayment(db: Db, orderId: string, now = new Date()) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true, invoices: { select: { status: true } } } });
  const paid = order.payments.reduce((s, p) => s + netPaid(p), 0);
  const refundedAny = order.payments.some((p) => p.refundedCents > 0);
  const balanceRequested = order.invoices.some((i) => i.status === "BALANCE_DUE");
  const paymentStatus = orderPaymentStatusFor(order, paid, refundedAny, balanceRequested);
  let productionStatus = order.productionStatus;
  if (productionStatus === "AWAITING_DEPOSIT" && (order.depositCents <= 0 || paid >= order.depositCents)) productionStatus = "ORDER_CONFIRMED";
  const autoConfirmed = productionStatus !== order.productionStatus;
  const events: Prisma.StatusEventCreateWithoutOrderInput[] = [];
  if (paymentStatus !== order.paymentStatus) events.push({ fromStatus: `payment:${order.paymentStatus}`, toStatus: `payment:${paymentStatus}` });
  if (autoConfirmed) events.push({ fromStatus: order.productionStatus, toStatus: productionStatus });
  const updated = await db.order.update({
    where: { id: orderId },
    data: {
      paymentStatus,
      productionStatus,
      paidAt: paymentStatus === "PAID" ? (order.paidAt ?? now) : null,
      ...(events.length ? { statusEvents: { create: events } } : {}),
    },
  });
  return { order: updated, autoConfirmed };
}

/** Kept for older admin pages that call it; balance-based statuses have no "past due" step. */
export async function markPastDueInvoices() {
  return 0;
}

/** Re-derive one invoice outside a transaction (e.g. after an admin page loads). */
export function refreshInvoice(invoiceId: string) {
  return prisma.$transaction((tx) => recomputeInvoice(tx, invoiceId));
}
