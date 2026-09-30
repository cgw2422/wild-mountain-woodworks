import "server-only";
import type { DeliveryStatus, Prisma, ProductionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { formatCents } from "@/lib/money";
import { sendTemplateEmail } from "@/lib/email/send";
import { siteDateLong } from "@/lib/site-time";
import { recordCustomerActivity } from "./customers";
import { SalesError } from "./errors";
import { recomputeOrderPayment } from "./ledger";
import { customerLinks } from "./links";
import { nextNumber } from "./numbers";
import { DELIVERY_STATUS_LABELS, PRODUCTION_STATUS_LABELS } from "./status";
import { newCustomerToken } from "./tokens";

type Db = Prisma.TransactionClient;
export type Actor = { id: string; name: string };

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
  const order = await tx.order.create({
    data: {
      number,
      customerToken: newCustomerToken(),
      customerId: quote.customerId,
      quoteId: quote.id,
      acceptedRevisionId: revision.id,
      productionStatus: revision.depositCents > 0 ? "AWAITING_DEPOSIT" : "QUOTE_ACCEPTED",
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
      statusEvents: { create: { toStatus: revision.depositCents > 0 ? "AWAITING_DEPOSIT" : "QUOTE_ACCEPTED" } },
    },
  });
  await recordCustomerActivity(tx, { customerId: quote.customerId, type: "order.created", message: `Order ${number} created from quote ${quote.number}`, quoteId: quote.id, orderId: order.id });
  return order;
}

export interface OrderUpdateInput {
  productionStatus: ProductionStatus;
  deliveryStatus: DeliveryStatus;
  deliveryDate: Date | null;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  estimatedCompletion: string | null;
  productionNotes: string | null;
  customerNotes: string | null;
  notifyCustomer: boolean;
}

/** Admin update of production, delivery and notes. Status changes are recorded; the customer is emailed only when asked. */
export async function updateOrder(actor: Actor, orderId: string, input: OrderUpdateInput) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new SalesError("That order no longer exists.");
  if (order.productionStatus === "CANCELED" && input.productionStatus !== "CANCELED") {
    throw new SalesError("This order is canceled. Reopen it first.");
  }
  const now = new Date();
  const productionChanged = input.productionStatus !== order.productionStatus;
  const deliveryChanged = input.deliveryStatus !== order.deliveryStatus || (input.deliveryDate?.getTime() ?? null) !== (order.deliveryDate?.getTime() ?? null);

  const updated = await prisma.$transaction(async (tx) => {
    const events: Prisma.StatusEventCreateWithoutOrderInput[] = [];
    const author = { connect: { id: actor.id } };
    if (productionChanged) events.push({ fromStatus: order.productionStatus, toStatus: input.productionStatus, author });
    if (input.deliveryStatus !== order.deliveryStatus) events.push({ fromStatus: `delivery:${order.deliveryStatus}`, toStatus: `delivery:${input.deliveryStatus}`, author });
    const row = await tx.order.update({
      where: { id: orderId },
      data: {
        productionStatus: input.productionStatus,
        deliveryStatus: input.deliveryStatus,
        deliveryDate: input.deliveryDate,
        deliveryAddress: input.deliveryAddress,
        deliveryNotes: input.deliveryNotes,
        estimatedCompletion: input.estimatedCompletion,
        productionNotes: input.productionNotes,
        customerNotes: input.customerNotes,
        completedAt: input.productionStatus === "COMPLETED" ? (order.completedAt ?? now) : null,
        canceledAt: input.productionStatus === "CANCELED" ? (order.canceledAt ?? now) : null,
        ...(events.length ? { statusEvents: { create: events } } : {}),
      },
    });
    if (productionChanged) {
      await recordCustomerActivity(tx, {
        customerId: order.customerId,
        type: input.productionStatus === "COMPLETED" ? "order.completed" : input.productionStatus === "CANCELED" ? "order.canceled" : "order.status",
        message: `Order ${order.number}: ${PRODUCTION_STATUS_LABELS[input.productionStatus]}`,
        orderId,
        actorId: actor.id,
      });
      if (input.productionStatus === "COMPLETED" && order.quoteId) {
        await tx.quoteRequest.updateMany({ where: { id: order.quoteId, status: { in: ["ACCEPTED", "CONVERTED_TO_INVOICE"] } }, data: { status: "COMPLETED" } });
      }
    }
    if (deliveryChanged) {
      await recordCustomerActivity(tx, {
        customerId: order.customerId,
        type: "order.delivery",
        message: `Order ${order.number} delivery: ${DELIVERY_STATUS_LABELS[input.deliveryStatus]}${input.deliveryDate ? ` (${siteDateLong(input.deliveryDate)})` : ""}`,
        orderId,
        actorId: actor.id,
      });
    }
    await recomputeOrderPayment(tx, orderId, now);
    return row;
  });

  if (productionChanged) {
    await logActivity("order.production_status_changed", `${actor.name} moved order ${order.number} to ${PRODUCTION_STATUS_LABELS[input.productionStatus]}`, { actorId: actor.id, entityType: "order", entityId: orderId });
  }

  if (input.notifyCustomer && order.customerToken) {
    const base = { customerName: order.customerName, orderNumber: order.number };
    const links = { customerId: order.customerId, orderId, quoteId: order.quoteId };
    const url = customerLinks.order(order.customerToken);
    if (input.productionStatus === "COMPLETED" && productionChanged) {
      await sendTemplateEmail({ template: "order_completed", to: order.customerEmail, vars: base, actionUrl: url, links });
    } else if (deliveryChanged && input.deliveryDate && (input.deliveryStatus === "SCHEDULED" || input.productionStatus === "DELIVERY_SCHEDULED")) {
      await sendTemplateEmail({ template: "delivery_scheduled", to: order.customerEmail, vars: { ...base, deliveryDate: siteDateLong(input.deliveryDate), deliveryNotes: input.deliveryNotes }, actionUrl: url, links });
    } else if (productionChanged) {
      await sendTemplateEmail({
        template: "order_update",
        to: order.customerEmail,
        vars: { ...base, status: PRODUCTION_STATUS_LABELS[input.productionStatus], estimatedCompletion: input.estimatedCompletion },
        actionUrl: url,
        links,
      });
    }
  }
  return updated;
}

/** Money summary for an order (for admin and customer pages). */
export function orderMoney(order: { totalCents: number; depositCents: number }, payments: Array<{ amountCents: number; refundedCents: number; status: string }>) {
  const paid = payments.reduce((s, p) => (["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status) ? s + p.amountCents - p.refundedCents : s), 0);
  return { totalCents: order.totalCents, depositCents: order.depositCents, paidCents: paid, balanceCents: Math.max(0, order.totalCents - paid), label: `${formatCents(paid)} of ${formatCents(order.totalCents)} paid` };
}
