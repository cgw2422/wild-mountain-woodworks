import "server-only";
import type { Prisma, ProductionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { formatCents } from "@/lib/money";
import { sendTemplateEmail, type SendResult } from "@/lib/email/send";
import { siteDateLong } from "@/lib/site-time";
import { recordCustomerActivity } from "./customers";
import { SalesError } from "./errors";
import { recomputeOrderPayment } from "./ledger";
import { customerLinks } from "./links";
import { nextNumber } from "./numbers";
import { NOTIFY_PRODUCTION_STATUSES, PRODUCTION_STATUSES, PRODUCTION_STATUS_LABELS, deliveryMethodLabel, type ProductionStatusValue } from "./status";
import { newCustomerToken } from "./tokens";

type Db = Prisma.TransactionClient;
export type Actor = { id: string; name: string; role?: string };

/*
 * Production status is the customer-facing stage of the build:
 *   AWAITING_DEPOSIT → ORDER_CONFIRMED → IN_PRODUCTION → READY_FOR_DELIVERY
 *   → DELIVERY_SCHEDULED → COMPLETED   (or CANCELED)
 * Payment status is separate (ledger.ts). The only automatic step is
 * AWAITING_DEPOSIT → ORDER_CONFIRMED when the deposit is covered.
 * Meaningful changes email the customer (unless the admin unticks it); every
 * notification — sent, failed, suppressed or skipped — is recorded.
 */

/**
 * Create the order for an accepted revision (inside the acceptance
 * transaction). Items are copied from the accepted lines, so later quote or
 * catalog edits never change what was agreed.
 */
export async function createOrderFromRevision(
  tx: Db,
  quote: { id: string; customerId: string | null; number: string | null },
  revision: Prisma.QuoteRevisionGetPayload<{ include: { lineItems: true } }>,
) {
  const number = await nextNumber("order", tx);
  const initial: ProductionStatus = revision.depositCents > 0 ? "AWAITING_DEPOSIT" : "ORDER_CONFIRMED";
  const order = await tx.order.create({
    data: {
      number,
      customerToken: newCustomerToken(),
      customerId: quote.customerId,
      quoteId: quote.id,
      acceptedRevisionId: revision.id,
      productionStatus: initial,
      paymentStatus: revision.depositCents > 0 ? "DEPOSIT_DUE" : "UNPAID",
      customerName: revision.customerName,
      customerEmail: revision.customerEmail,
      customerPhone: revision.customerPhone,
      deliveryAddress: revision.customerAddress,
      estimatedCompletion: revision.estimatedCompletion,
      deliveryNotes: revision.deliveryDetails,
      subtotalCents: revision.subtotalCents,
      discountCents: revision.discountCents,
      shippingCents: revision.deliveryCents + revision.otherChargesCents,
      taxCents: revision.taxCents,
      totalCents: revision.totalCents,
      depositCents: revision.depositCents,
      customerNotes: revision.customerNotes,
      items: {
        create: revision.lineItems.map((l) => ({
          productId: l.productId,
          productName: l.description,
          description: l.description,
          notes: l.notes,
          kind: l.kind,
          position: l.position,
          configuration: (l.configuration ?? {}) as Prisma.InputJsonValue,
          unitPriceCents: l.unitPriceCents,
          quantity: l.quantity,
          lineTotalCents: l.lineTotalCents,
        })),
      },
      statusEvents: { create: { toStatus: initial } },
    },
  });
  await recordCustomerActivity(tx, { customerId: quote.customerId, type: "order.created", message: `Order ${number} created from quote ${quote.number}`, quoteId: quote.id, orderId: order.id });
  return order;
}

/* ------------------------------------------------------------ status emails */

/** Which editable template each customer-facing stage uses. */
export const STATUS_EMAIL_TEMPLATES: Partial<Record<ProductionStatusValue, string>> = {
  ORDER_CONFIRMED: "order_confirmed",
  IN_PRODUCTION: "order_in_production",
  READY_FOR_DELIVERY: "order_ready",
  DELIVERY_SCHEDULED: "delivery_scheduled",
  COMPLETED: "order_completed",
  CANCELED: "order_canceled",
};

type OrderForEmail = {
  id: string;
  number: string;
  customerId: string | null;
  quoteId: string | null;
  customerName: string;
  customerEmail: string;
  customerToken: string | null;
  deliveryDate: Date | null;
  deliveryWindow: string | null;
  deliveryMethod: string | null;
  deliveryNotes: string | null;
  deliveryAddress: string | null;
  estimatedCompletion: string | null;
};

/** "Thursday, November 5, 2026 · 9am–12pm · White glove delivery" */
export function deliveryDetails(o: Pick<OrderForEmail, "deliveryDate" | "deliveryWindow" | "deliveryMethod">) {
  return [o.deliveryDate ? siteDateLong(o.deliveryDate) : null, o.deliveryWindow, deliveryMethodLabel(o.deliveryMethod)].filter(Boolean).join(" · ");
}

type NotifyMode = "send" | "suppressed" | "covered";

/**
 * Email the customer about a production stage and record the notification.
 * Never throws for a delivery failure: the status change stands and the
 * admin can resend.
 */
async function notifyStatus(order: OrderForEmail, from: string | null, to: ProductionStatusValue, mode: NotifyMode, actor: Actor | null): Promise<{ status: string; result: SendResult | null }> {
  const template = STATUS_EMAIL_TEMPLATES[to];
  if (!template) return { status: "NONE", result: null };
  const base = { orderId: order.id, fromStatus: from, toStatus: to, customerId: order.customerId, email: order.customerEmail, initiatedById: actor?.id ?? null };
  if (mode !== "send" || !order.customerToken) {
    const status = mode === "covered" ? "SKIPPED" : "SUPPRESSED";
    await prisma.statusNotification.create({ data: { ...base, status, error: mode === "covered" ? "Covered by the deposit confirmation email" : !order.customerToken ? "No customer link" : null } });
    await logActivity("order.status_email", `${PRODUCTION_STATUS_LABELS[to]} email for order ${order.number} ${status === "SKIPPED" ? "not needed (deposit confirmation sent)" : `suppressed${actor ? ` by ${actor.name}` : ""}`}`, { actorId: actor?.id ?? null, entityType: "order", entityId: order.id });
    return { status, result: null };
  }
  const result = await sendTemplateEmail({
    template,
    to: order.customerEmail,
    vars: {
      customerName: order.customerName,
      orderNumber: order.number,
      status: PRODUCTION_STATUS_LABELS[to],
      deliveryDetails: deliveryDetails(order) || "We'll be in touch to confirm the details.",
      // Older stored copies of the delivery template use {{deliveryDate}}.
      deliveryDate: order.deliveryDate ? siteDateLong(order.deliveryDate) : null,
      deliveryNotes: order.deliveryNotes,
      estimatedCompletion: order.estimatedCompletion,
    },
    actionUrl: customerLinks.order(order.customerToken),
    requiredButton: "View Your Order",
    links: { customerId: order.customerId, orderId: order.id, quoteId: order.quoteId },
  });
  const status = result.status === "SENT" ? "SENT" : result.status === "FAILED" ? "FAILED" : "SKIPPED";
  await prisma.statusNotification.create({
    data: { ...base, status, error: result.status === "SKIPPED" ? "Email template is switched off" : (result.error ?? null), emailLogId: result.logId, sentAt: status === "SENT" ? new Date() : null },
  });
  await recordCustomerActivity(prisma as unknown as Db, {
    customerId: order.customerId,
    type: "order.notification",
    message: `${PRODUCTION_STATUS_LABELS[to]} email ${status === "SENT" ? "sent" : status === "FAILED" ? `failed: ${result.error ?? "error"}` : "not sent (template off)"} to ${order.customerEmail}`,
    orderId: order.id,
    actorId: actor?.id ?? null,
  });
  await logActivity("order.status_email", `${PRODUCTION_STATUS_LABELS[to]} email for order ${order.number} ${status === "SENT" ? "sent" : status === "FAILED" ? "FAILED" : "skipped (template off)"} to ${order.customerEmail}`, { actorId: actor?.id ?? null, entityType: "order", entityId: order.id });
  return { status, result };
}

/** After a payment moved AWAITING_DEPOSIT → ORDER_CONFIRMED automatically. */
export async function notifyAutoConfirmed(orderId: string, mode: NotifyMode, actor: Actor | null) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.productionStatus !== "ORDER_CONFIRMED") return;
  await notifyStatus(order, "AWAITING_DEPOSIT", "ORDER_CONFIRMED", mode, actor);
}

/** Email the customer about the order's current stage again (e.g. after a failed send, or new delivery details). */
export async function resendStatusEmail(actor: Actor, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new SalesError("That order no longer exists.");
  if (!STATUS_EMAIL_TEMPLATES[order.productionStatus]) throw new SalesError(`There's no customer email for “${PRODUCTION_STATUS_LABELS[order.productionStatus]}”.`);
  return notifyStatus(order, order.productionStatus, order.productionStatus, "send", actor);
}

/* ------------------------------------------------------------ admin updates */

export interface OrderUpdateInput {
  productionStatus: ProductionStatus;
  deliveryDate: Date | null;
  deliveryWindow?: string | null;
  deliveryMethod?: string | null;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  estimatedCompletion: string | null;
  productionNotes: string | null;
  customerNotes: string | null;
  /** Email the customer about a production change (defaults on for meaningful stages). */
  notifyCustomer: boolean;
}

export interface OrderUpdateResult {
  productionChanged: boolean;
  /** SENT | FAILED | SUPPRESSED | SKIPPED | NONE */
  notification: string;
  error?: string;
}

/**
 * Admin update of production stage, delivery details and notes. The new
 * status always sticks — a failed email is recorded (and can be resent),
 * never rolled back. Unchanged status → no email.
 */
export async function updateOrder(actor: Actor, orderId: string, input: OrderUpdateInput): Promise<OrderUpdateResult> {
  if (!(PRODUCTION_STATUSES as readonly string[]).includes(input.productionStatus)) throw new SalesError("Choose a production status.", { productionStatus: "Invalid status." });
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new SalesError("That order no longer exists.");
  if (order.productionStatus === "CANCELED" && input.productionStatus !== "CANCELED") throw new SalesError("This order is canceled and can't be moved to another stage.");
  if (input.productionStatus === "DELIVERY_SCHEDULED" && !input.deliveryDate) throw new SalesError("Add the delivery or pickup date.", { deliveryDate: "Add the date." });
  const now = new Date();
  const productionChanged = input.productionStatus !== order.productionStatus;

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        productionStatus: input.productionStatus,
        deliveryDate: input.deliveryDate,
        deliveryWindow: input.deliveryWindow ?? null,
        deliveryMethod: input.deliveryMethod ?? null,
        deliveryAddress: input.deliveryAddress,
        deliveryNotes: input.deliveryNotes,
        estimatedCompletion: input.estimatedCompletion,
        productionNotes: input.productionNotes,
        customerNotes: input.customerNotes,
        // Older delivery tracking, kept in step for existing reports.
        deliveryStatus: input.productionStatus === "DELIVERY_SCHEDULED" ? "SCHEDULED" : input.productionStatus === "COMPLETED" ? (input.deliveryMethod === "PICKUP" ? "PICKED_UP" : "DELIVERED") : order.deliveryStatus,
        completedAt: input.productionStatus === "COMPLETED" ? (order.completedAt ?? now) : null,
        canceledAt: input.productionStatus === "CANCELED" ? (order.canceledAt ?? now) : null,
        ...(productionChanged ? { statusEvents: { create: { fromStatus: order.productionStatus, toStatus: input.productionStatus, author: { connect: { id: actor.id } } } } } : {}),
      },
    });
    if (productionChanged) {
      await recordCustomerActivity(tx, {
        customerId: order.customerId,
        type: input.productionStatus === "COMPLETED" ? "order.completed" : input.productionStatus === "CANCELED" ? "order.canceled" : "order.status",
        message: `Order ${order.number}: ${PRODUCTION_STATUS_LABELS[input.productionStatus]}${input.productionStatus === "DELIVERY_SCHEDULED" ? ` (${deliveryDetails({ deliveryDate: input.deliveryDate, deliveryWindow: input.deliveryWindow ?? null, deliveryMethod: input.deliveryMethod ?? null })})` : ""}`,
        orderId,
        actorId: actor.id,
      });
      if (input.productionStatus === "COMPLETED" && order.quoteId) {
        await tx.quoteRequest.updateMany({ where: { id: order.quoteId, status: { in: ["ACCEPTED", "CONVERTED_TO_INVOICE"] } }, data: { status: "COMPLETED" } });
      }
    }
    await recomputeOrderPayment(tx, orderId, now);
  });

  if (!productionChanged) return { productionChanged, notification: "NONE" };
  await logActivity("order.production_status_changed", `${actor.name} moved order ${order.number} from ${PRODUCTION_STATUS_LABELS[order.productionStatus as ProductionStatusValue] ?? order.productionStatus} to ${PRODUCTION_STATUS_LABELS[input.productionStatus]}`, { actorId: actor.id, entityType: "order", entityId: orderId });
  if (input.productionStatus === "CANCELED") {
    // Nothing can be paid online on a canceled order.
    const { closeOpenCheckout } = await import("./checkout");
    const invoices = await prisma.invoice.findMany({ where: { orderId, stripeCheckoutStatus: "open" }, select: { id: true } });
    for (const i of invoices) await closeOpenCheckout(i.id).catch(() => undefined);
  }
  if (!NOTIFY_PRODUCTION_STATUSES.includes(input.productionStatus)) return { productionChanged, notification: "NONE" };
  const fresh = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const sent = await notifyStatus(fresh, order.productionStatus, input.productionStatus, input.notifyCustomer ? "send" : "suppressed", actor);
  return { productionChanged, notification: sent.status, error: sent.result?.error };
}

/** Money summary for an order (for admin and customer pages). */
export function orderMoney(order: { totalCents: number; depositCents: number }, payments: Array<{ amountCents: number; refundedCents: number; status: string }>) {
  const paid = payments.reduce((s, p) => (["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status) ? s + p.amountCents - p.refundedCents : s), 0);
  const pending = payments.reduce((s, p) => (p.status === "PENDING" ? s + p.amountCents : s), 0);
  return { totalCents: order.totalCents, depositCents: order.depositCents, paidCents: paid, pendingCents: pending, balanceCents: Math.max(0, order.totalCents - paid), label: `${formatCents(paid)} of ${formatCents(order.totalCents)} paid` };
}
