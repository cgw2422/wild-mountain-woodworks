import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient | typeof prisma;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The customer record for an email address, created if needed. Matching is
 * by exact (case-insensitive) email only — nothing fuzzier — so two people
 * are never merged by accident. Existing details are only filled in where
 * blank; a customer's name or address is never overwritten by a new request.
 */
export async function findOrCreateCustomer(
  db: Db,
  input: { name: string; email: string; phone?: string | null; zipCode?: string | null; address?: string | null },
) {
  const email = normalizeEmail(input.email);
  const existing = await db.customer.findFirst({ where: { email }, orderBy: { createdAt: "asc" } });
  if (existing) {
    return db.customer.update({
      where: { id: existing.id },
      data: {
        lastActivityAt: new Date(),
        ...(existing.phone ? {} : { phone: input.phone ?? null }),
        ...(existing.zipCode ? {} : { zipCode: input.zipCode ?? null }),
        ...(existing.deliveryAddress ? {} : { deliveryAddress: input.address ?? null }),
      },
    });
  }
  return db.customer.create({
    data: { name: input.name.trim(), email, phone: input.phone ?? null, zipCode: input.zipCode ?? null, deliveryAddress: input.address ?? null },
  });
}

export type CustomerActivityType =
  | "quote.requested"
  | "quote.created"
  | "quote.sent"
  | "quote.viewed"
  | "quote.accepted"
  | "quote.declined"
  | "quote.expired"
  | "quote.extended"
  | "invoice.sent"
  | "invoice.voided"
  | "payment.received"
  | "payment.failed"
  | "payment.voided"
  | "payment.refunded"
  | "order.created"
  | "order.status"
  | "order.delivery"
  | "order.completed"
  | "order.canceled"
  | "email.sent"
  | "communication.call"
  | "communication.email"
  | "communication.meeting"
  | "communication.note";

/** Append to the customer timeline. No-op without a customer. */
export async function recordCustomerActivity(
  db: Db,
  a: { customerId: string | null | undefined; type: CustomerActivityType; message: string; quoteId?: string | null; invoiceId?: string | null; orderId?: string | null; actorId?: string | null; at?: Date },
) {
  if (!a.customerId) return;
  const at = a.at ?? new Date();
  await db.customerActivity.create({
    data: {
      customerId: a.customerId,
      type: a.type,
      message: a.message.slice(0, 1000),
      quoteId: a.quoteId ?? null,
      invoiceId: a.invoiceId ?? null,
      orderId: a.orderId ?? null,
      actorId: a.actorId ?? null,
      createdAt: at,
    },
  });
  await db.customer.update({ where: { id: a.customerId }, data: { lastActivityAt: at } });
}
