import { CONTACT_REASONS } from "@/lib/validation/forms";
import {
  type ContactReason,
  CustomRequestStatus,
  MessageStatus,
  ProductionStatus,
  QuoteStatus,
} from "@/generated/prisma/enums";

/**
 * Inbox record kinds shared by the notes / status components and the generic
 * inbox server actions. Pure data — safe to import from client components.
 */
export type InboxKind = "quote" | "custom_request" | "message" | "order";

export const INBOX_KINDS: readonly InboxKind[] = ["quote", "custom_request", "message", "order"];

export const INBOX_KIND_META: Record<InboxKind, { label: string; basePath: string; statuses: readonly string[] }> = {
  quote: { label: "Quote request", basePath: "/admin/quotes", statuses: Object.values(QuoteStatus) },
  custom_request: { label: "Custom request", basePath: "/admin/custom-requests", statuses: Object.values(CustomRequestStatus) },
  message: { label: "Message", basePath: "/admin/messages", statuses: Object.values(MessageStatus) },
  // Orders: the admin-editable status is the production status. Payment
  // status is only ever set by the Stripe webhook.
  order: { label: "Order", basePath: "/admin/orders", statuses: Object.values(ProductionStatus) },
};

export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  ORDER_RECEIVED: "Order Received",
  DESIGN_CONFIRMATION: "Design Confirmation",
  MATERIALS_PREPARED: "Materials Prepared",
  IN_PRODUCTION: "In Production",
  FINISHING: "Finishing",
  READY_FOR_DELIVERY: "Ready for Delivery",
  COMPLETED: "Completed",
};

export function contactReasonLabel(reason: ContactReason | string): string {
  return CONTACT_REASONS.find((r) => r.value === reason)?.label ?? statusLabel(reason);
}

/** Human label for any stored status value (StatusEvent stores plain strings). */
export function statusLabel(value: string): string {
  if (value in PRODUCTION_STATUS_LABELS && value !== "COMPLETED") return PRODUCTION_STATUS_LABELS[value as ProductionStatus];
  return value
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}
