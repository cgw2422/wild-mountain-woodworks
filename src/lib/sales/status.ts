/**
 * Labels and groupings for sales statuses. Client-safe (no Prisma import) so
 * admin and customer UI can share them.
 */

export const QUOTE_STATUSES = ["NEW", "REVIEWING", "DRAFT", "SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED", "CONVERTED_TO_INVOICE", "CANCELED", "COMPLETED"] as const;
export type QuoteStatusValue = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatusValue, string> = {
  NEW: "New",
  REVIEWING: "Reviewing",
  DRAFT: "Draft",
  SENT: "Sent",
  VIEWED: "Viewed",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  CONVERTED_TO_INVOICE: "Invoiced",
  CANCELED: "Canceled",
  COMPLETED: "Completed",
};

/** Quotes that still need Wild Mountain to do something before sending. */
export const QUOTE_OPEN_STATUSES: QuoteStatusValue[] = ["NEW", "REVIEWING", "DRAFT"];
/** Quotes waiting on the customer. */
export const QUOTE_AWAITING_STATUSES: QuoteStatusValue[] = ["SENT", "VIEWED"];
/** No further customer action is possible. */
export const QUOTE_CLOSED_STATUSES: QuoteStatusValue[] = ["DECLINED", "EXPIRED", "CANCELED", "COMPLETED"];

export const REVISION_STATUS_LABELS = { DRAFT: "Draft", SENT: "Sent", SUPERSEDED: "Superseded", ACCEPTED: "Accepted", DECLINED: "Declined" } as const;

export const INVOICE_STATUSES = ["DRAFT", "SENT", "OPEN", "PARTIALLY_PAID", "PAID", "PAST_DUE", "VOID", "CANCELED"] as const;
export type InvoiceStatusValue = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatusValue, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  OPEN: "Open",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  PAST_DUE: "Past due",
  VOID: "Void",
  CANCELED: "Canceled",
};
/** Invoices that still expect money. */
export const INVOICE_UNPAID_STATUSES: InvoiceStatusValue[] = ["SENT", "OPEN", "PARTIALLY_PAID", "PAST_DUE"];

export const INVOICE_KIND_LABELS = { DEPOSIT: "Deposit", BALANCE: "Final balance", FULL: "Full payment", CUSTOM: "Invoice" } as const;

export const PRODUCTION_STATUSES = [
  "QUOTE_ACCEPTED",
  "AWAITING_DEPOSIT",
  "DEPOSIT_PAID",
  "DESIGN_CONFIRMATION",
  "MATERIALS_ORDERED",
  "MATERIALS_READY",
  "IN_PRODUCTION",
  "SANDING",
  "FINISHING",
  "CURING",
  "READY_FOR_DELIVERY",
  "DELIVERY_SCHEDULED",
  "COMPLETED",
  "CANCELED",
] as const;
export type ProductionStatusValue = (typeof PRODUCTION_STATUSES)[number];
export const PRODUCTION_STATUS_LABELS: Record<ProductionStatusValue, string> = {
  QUOTE_ACCEPTED: "Quote accepted",
  AWAITING_DEPOSIT: "Awaiting deposit",
  DEPOSIT_PAID: "Deposit paid",
  DESIGN_CONFIRMATION: "Design confirmation",
  MATERIALS_ORDERED: "Materials ordered",
  MATERIALS_READY: "Materials ready",
  IN_PRODUCTION: "In production",
  SANDING: "Sanding",
  FINISHING: "Finishing",
  CURING: "Curing",
  READY_FOR_DELIVERY: "Ready for delivery",
  DELIVERY_SCHEDULED: "Delivery scheduled",
  COMPLETED: "Completed",
  CANCELED: "Canceled",
};
/** Orders the shop is actively working on. */
export const PRODUCTION_ACTIVE: ProductionStatusValue[] = ["DEPOSIT_PAID", "DESIGN_CONFIRMATION", "MATERIALS_ORDERED", "MATERIALS_READY", "IN_PRODUCTION", "SANDING", "FINISHING", "CURING"];

/** Customer-facing progress steps on /order/[token]. */
export const CUSTOMER_PROGRESS: Array<{ label: string; statuses: ProductionStatusValue[] }> = [
  { label: "Order confirmed", statuses: ["QUOTE_ACCEPTED", "AWAITING_DEPOSIT"] },
  { label: "Deposit received", statuses: ["DEPOSIT_PAID", "DESIGN_CONFIRMATION"] },
  { label: "Materials", statuses: ["MATERIALS_ORDERED", "MATERIALS_READY"] },
  { label: "Building", statuses: ["IN_PRODUCTION", "SANDING"] },
  { label: "Finishing", statuses: ["FINISHING", "CURING"] },
  { label: "Delivery", statuses: ["READY_FOR_DELIVERY", "DELIVERY_SCHEDULED"] },
  { label: "Complete", statuses: ["COMPLETED"] },
];

export const ORDER_PAYMENT_STATUS_LABELS = {
  UNPAID: "Unpaid",
  DEPOSIT_DUE: "Deposit due",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid in full",
  REFUNDED: "Refunded",
  CANCELED: "Canceled",
} as const;

export const DELIVERY_STATUSES = ["NOT_SCHEDULED", "SCHEDULED", "OUT_FOR_DELIVERY", "DELIVERED", "PICKUP_READY", "PICKED_UP"] as const;
export type DeliveryStatusValue = (typeof DELIVERY_STATUSES)[number];
export const DELIVERY_STATUS_LABELS: Record<DeliveryStatusValue, string> = {
  NOT_SCHEDULED: "Not scheduled",
  SCHEDULED: "Scheduled",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  PICKUP_READY: "Ready for pickup",
  PICKED_UP: "Picked up",
};

export const MANUAL_PAYMENT_METHODS = ["CASH", "CHECK", "BANK_TRANSFER", "OTHER"] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS = { STRIPE: "Card / online (Stripe)", CASH: "Cash", CHECK: "Check", BANK_TRANSFER: "Bank transfer", OTHER: "Other" } as const;
export const PAYMENT_STATUS_LABELS = {
  SUCCEEDED: "Succeeded",
  PENDING: "Pending",
  FAILED: "Failed",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partially refunded",
  VOIDED: "Voided",
} as const;

export type Tone = "neutral" | "green" | "amber" | "blue" | "red" | "violet" | "dark";

const TONES: Record<string, Tone> = {
  NEW: "blue",
  REVIEWING: "violet",
  DRAFT: "neutral",
  SENT: "amber",
  VIEWED: "amber",
  OPEN: "amber",
  ACCEPTED: "green",
  DECLINED: "red",
  EXPIRED: "neutral",
  CONVERTED_TO_INVOICE: "green",
  CANCELED: "red",
  COMPLETED: "dark",
  SUPERSEDED: "neutral",
  PARTIALLY_PAID: "violet",
  PAID: "green",
  PAST_DUE: "red",
  VOID: "neutral",
  UNPAID: "neutral",
  DEPOSIT_DUE: "amber",
  REFUNDED: "red",
  AWAITING_DEPOSIT: "amber",
  DEPOSIT_PAID: "green",
  QUOTE_ACCEPTED: "blue",
  READY_FOR_DELIVERY: "green",
  DELIVERY_SCHEDULED: "green",
  SUCCEEDED: "green",
  PENDING: "amber",
  FAILED: "red",
  VOIDED: "neutral",
  PARTIALLY_REFUNDED: "amber",
};

export function statusTone(status: string): Tone {
  return TONES[status] ?? "neutral";
}

const ALL_LABELS: Record<string, string> = {
  ...QUOTE_STATUS_LABELS,
  ...REVISION_STATUS_LABELS,
  ...INVOICE_STATUS_LABELS,
  ...PRODUCTION_STATUS_LABELS,
  ...ORDER_PAYMENT_STATUS_LABELS,
  ...DELIVERY_STATUS_LABELS,
  ...PAYMENT_STATUS_LABELS,
};

export function statusLabel(status: string): string {
  return ALL_LABELS[status] ?? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
}
