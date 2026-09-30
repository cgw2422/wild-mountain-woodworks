import { CONTACT_REASONS } from "@/lib/validation/forms";
import { type ContactReason, CustomRequestStatus, MessageStatus } from "@/generated/prisma/enums";
import { statusLabel as salesStatusLabel } from "@/lib/sales/status";

/**
 * Record kinds shared by the notes / status components and the generic
 * inbox server actions. Pure data — safe to import from client components.
 *
 * Quote and order statuses are NOT changed through the generic status
 * action: they follow the sales workflow (src/lib/sales) and have their own
 * actions. Invoices and customers only use notes here.
 */
export type InboxKind = "quote" | "custom_request" | "message" | "order" | "invoice" | "customer";

export const INBOX_KINDS: readonly InboxKind[] = ["quote", "custom_request", "message", "order", "invoice", "customer"];

export const INBOX_KIND_META: Record<InboxKind, { label: string; basePath: string; statuses: readonly string[] }> = {
  quote: { label: "Quote", basePath: "/admin/quotes", statuses: [] },
  custom_request: { label: "Custom request", basePath: "/admin/custom-requests", statuses: Object.values(CustomRequestStatus) },
  message: { label: "Message", basePath: "/admin/messages", statuses: Object.values(MessageStatus) },
  order: { label: "Order", basePath: "/admin/orders", statuses: [] },
  invoice: { label: "Invoice", basePath: "/admin/invoices", statuses: [] },
  customer: { label: "Customer", basePath: "/admin/customers", statuses: [] },
};

export function contactReasonLabel(reason: ContactReason | string): string {
  return CONTACT_REASONS.find((r) => r.value === reason)?.label ?? statusLabel(reason);
}

/** Human label for any stored status value (StatusEvent stores plain strings, e.g. "payment:PAID"). */
export function statusLabel(value: string): string {
  const [prefix, rest] = value.includes(":") ? value.split(":", 2) : [null, value];
  const label = salesStatusLabel(rest!);
  if (prefix === "payment") return `Payment: ${label}`;
  if (prefix === "delivery") return `Delivery: ${label}`;
  return label;
}
