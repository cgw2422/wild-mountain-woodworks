import "server-only";
import type { InvoiceStatus, OrderPaymentStatus, Prisma, ProductionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient;

/**
 * Money state is always DERIVED from Payment records — never typed in and
 * never trusted from a browser. These functions recompute an invoice's paid
 * amount/status and an order's payment status after any payment change.
 */

/** Net money kept from a payment (after refunds); voided/failed/pending count as 0. */
export function netPaid(p: { amountCents: number; refundedCents: number; status: string }): number {
  if (p.status === "SUCCEEDED" || p.status === "PARTIALLY_REFUNDED" || p.status === "REFUNDED") return Math.max(0, p.amountCents - p.refundedCents);
  return 0;
}

export function invoiceStatusFor(
  inv: { status: InvoiceStatus; totalCents: number; dueDate: Date | null; sentAt: Date | null; stripeInvoiceId: string | null },
  paidCents: number,
  now = new Date(),
): InvoiceStatus {
  if (inv.status === "VOID" || inv.status === "CANCELED") return inv.status;
  if (paidCents >= inv.totalCents && inv.totalCents > 0) return "PAID";
  if (paidCents > 0) return "PARTIALLY_PAID";
  if (inv.status === "DRAFT") return "DRAFT";
  if (inv.dueDate && inv.dueDate < now) return "PAST_DUE";
  return inv.stripeInvoiceId ? "OPEN" : "SENT";
}

export async function recomputeInvoice(db: Db, invoiceId: string, now = new Date()) {
  const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payments: true } });
  const paid = invoice.payments.reduce((s, p) => s + netPaid(p), 0);
  const status = invoiceStatusFor(invoice, paid, now);
  const becamePaid = status === "PAID" && invoice.status !== "PAID";
  const updated = await db.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaidCents: paid,
      status,
      paidAt: status === "PAID" ? (invoice.paidAt ?? now) : null,
      ...(status !== invoice.status ? { statusEvents: { create: { fromStatus: invoice.status, toStatus: status } } } : {}),
    },
  });
  if (updated.orderId) await recomputeOrderPayment(db, updated.orderId, now);
  return { invoice: updated, becamePaid };
}

export function orderPaymentStatusFor(o: { productionStatus: ProductionStatus; totalCents: number; depositCents: number }, paidCents: number, refundedAny: boolean): OrderPaymentStatus {
  if (o.productionStatus === "CANCELED" && paidCents === 0) return refundedAny ? "REFUNDED" : "CANCELED";
  if (refundedAny && paidCents === 0) return "REFUNDED";
  if (o.totalCents > 0 && paidCents >= o.totalCents) return "PAID";
  if (paidCents > 0) return "PARTIALLY_PAID";
  if (o.depositCents > 0) return "DEPOSIT_DUE";
  return "UNPAID";
}

/**
 * Recompute an order's payment status from its payments. When the deposit is
 * covered, an order waiting on it moves to DEPOSIT_PAID automatically.
 */
export async function recomputeOrderPayment(db: Db, orderId: string, now = new Date()) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
  const paid = order.payments.reduce((s, p) => s + netPaid(p), 0);
  const refundedAny = order.payments.some((p) => p.refundedCents > 0);
  const paymentStatus = orderPaymentStatusFor(order, paid, refundedAny);
  let productionStatus = order.productionStatus;
  if ((productionStatus === "AWAITING_DEPOSIT" || productionStatus === "QUOTE_ACCEPTED") && order.depositCents > 0 && paid >= order.depositCents) {
    productionStatus = "DEPOSIT_PAID";
  }
  const events: Prisma.StatusEventCreateWithoutOrderInput[] = [];
  if (paymentStatus !== order.paymentStatus) events.push({ fromStatus: `payment:${order.paymentStatus}`, toStatus: `payment:${paymentStatus}` });
  if (productionStatus !== order.productionStatus) events.push({ fromStatus: order.productionStatus, toStatus: productionStatus });
  return db.order.update({
    where: { id: orderId },
    data: {
      paymentStatus,
      productionStatus,
      paidAt: paymentStatus === "PAID" ? (order.paidAt ?? now) : null,
      ...(events.length ? { statusEvents: { create: events } } : {}),
    },
  });
}

/** Unpaid invoices past their due date become PAST_DUE (run lazily from admin pages). */
export async function markPastDueInvoices(now = new Date()) {
  const due = await prisma.invoice.findMany({ where: { status: { in: ["SENT", "OPEN"] }, dueDate: { lt: now } }, select: { id: true } });
  for (const { id } of due) await prisma.$transaction((tx) => recomputeInvoice(tx, id, now));
  return due.length;
}
