/**
 * Labels and groupings for sales statuses. Client-safe (no Prisma import) so
 * admin and customer UI can share them.
 */

export const QUOTE_STATUSES = ["NEW", "REVIEWING", "DRAFT", "SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED", "CONVERTED_TO_INVOICE", "CANCELED", "COMPLETED", "VOIDED"] as const;
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
  VOIDED: "Voided",
};

/** Quotes that still need Wild Mountain to do something before sending. */
export const QUOTE_OPEN_STATUSES: QuoteStatusValue[] = ["NEW", "REVIEWING", "DRAFT"];
/** Quotes waiting on the customer. */
export const QUOTE_AWAITING_STATUSES: QuoteStatusValue[] = ["SENT", "VIEWED"];
/** No further customer action is possible. */
export const QUOTE_CLOSED_STATUSES: QuoteStatusValue[] = ["DECLINED", "EXPIRED", "CANCELED", "COMPLETED", "VOIDED"];

export const REVISION_STATUS_LABELS = { DRAFT: "Draft", SENT: "Sent", SUPERSEDED: "Superseded", ACCEPTED: "Accepted", DECLINED: "Declined" } as const;

export const INVOICE_STATUSES = ["DRAFT", "SENT", "OPEN", "DEPOSIT_DUE", "PARTIALLY_PAID", "BALANCE_DUE", "PAID", "PAST_DUE", "VOIDED", "CANCELED"] as const;
export type InvoiceStatusValue = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatusValue, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  OPEN: "Open",
  DEPOSIT_DUE: "Deposit due",
  PARTIALLY_PAID: "Partially paid",
  BALANCE_DUE: "Balance due",
  PAID: "Paid",
  PAST_DUE: "Past due",
  VOIDED: "Voided",
  CANCELED: "Canceled",
};
/** Invoices that still expect money. */
export const INVOICE_UNPAID_STATUSES: InvoiceStatusValue[] = ["SENT", "OPEN", "DEPOSIT_DUE", "PARTIALLY_PAID", "BALANCE_DUE", "PAST_DUE"];
/** Invoices that are no longer collectible. */
export const INVOICE_CLOSED_STATUSES: InvoiceStatusValue[] = ["VOIDED", "CANCELED"];

/**
 * Why a quote or invoice was voided (stored with the voiding admin and time).
 * "Other" requires a short explanation.
 */
export const VOID_REASONS = ["Customer canceled", "Created in error", "Replaced by new quote", "Pricing mistake", "Duplicate record", "Other"] as const;

/** FULL is the one invoice per order; DEPOSIT and BALANCE exist only on older orders. */
export const INVOICE_KIND_LABELS = { DEPOSIT: "Deposit (older)", BALANCE: "Final balance (older)", FULL: "Order invoice", CUSTOM: "Invoice" } as const;

/** Customer-facing production stages. Payment state is tracked separately. */
export const PRODUCTION_STATUSES = ["AWAITING_DEPOSIT", "ORDER_CONFIRMED", "IN_PRODUCTION", "READY_FOR_DELIVERY", "DELIVERY_SCHEDULED", "COMPLETED", "CANCELED"] as const;
export type ProductionStatusValue = (typeof PRODUCTION_STATUSES)[number];
export const PRODUCTION_STATUS_LABELS: Record<ProductionStatusValue, string> = {
  AWAITING_DEPOSIT: "Awaiting deposit",
  ORDER_CONFIRMED: "Order confirmed",
  IN_PRODUCTION: "In production",
  READY_FOR_DELIVERY: "Ready for delivery",
  DELIVERY_SCHEDULED: "Delivery scheduled",
  COMPLETED: "Completed",
  CANCELED: "Canceled",
};
/** What each stage means (admin help text). */
export const PRODUCTION_STATUS_HELP: Record<ProductionStatusValue, string> = {
  AWAITING_DEPOSIT: "Quote accepted; the required deposit hasn't been paid yet.",
  ORDER_CONFIRMED: "Deposit received (or none required) — confirmed and queued for work.",
  IN_PRODUCTION: "Actively in the shop: materials, milling, assembly, sanding, finishing, curing… (keep details in internal notes).",
  READY_FOR_DELIVERY: "Complete and ready for delivery or pickup scheduling.",
  DELIVERY_SCHEDULED: "A delivery or pickup date is arranged.",
  COMPLETED: "Delivered or picked up.",
  CANCELED: "The order was canceled.",
};
/**
 * Older, detailed stages (before the simplified list). They no longer exist
 * on orders but still appear in status history, so they keep their labels.
 */
export const LEGACY_PRODUCTION_LABELS: Record<string, string> = {
  QUOTE_ACCEPTED: "Quote accepted",
  DEPOSIT_PAID: "Deposit paid",
  DESIGN_CONFIRMATION: "Design confirmation",
  MATERIALS_ORDERED: "Materials ordered",
  MATERIALS_READY: "Materials ready",
  SANDING: "Sanding",
  FINISHING: "Finishing",
  CURING: "Curing",
};
/** Orders the shop is actively working on. */
export const PRODUCTION_ACTIVE: ProductionStatusValue[] = ["ORDER_CONFIRMED", "IN_PRODUCTION"];
/** A production change to one of these emails the customer by default (the deposit flow covers AWAITING_DEPOSIT). */
export const NOTIFY_PRODUCTION_STATUSES: ProductionStatusValue[] = ["ORDER_CONFIRMED", "IN_PRODUCTION", "READY_FOR_DELIVERY", "DELIVERY_SCHEDULED", "COMPLETED", "CANCELED"];

/** Customer-facing progress on /order/[token] (Awaiting deposit and Canceled are shown separately). */
export const CUSTOMER_PROGRESS: Array<{ label: string; status: ProductionStatusValue }> = [
  { label: "Order confirmed", status: "ORDER_CONFIRMED" },
  { label: "In production", status: "IN_PRODUCTION" },
  { label: "Ready for delivery", status: "READY_FOR_DELIVERY" },
  { label: "Delivery scheduled", status: "DELIVERY_SCHEDULED" },
  { label: "Completed", status: "COMPLETED" },
];

export const ORDER_PAYMENT_STATUS_LABELS = {
  UNPAID: "Unpaid",
  DEPOSIT_DUE: "Deposit due",
  PARTIALLY_PAID: "Partially paid",
  BALANCE_DUE: "Balance due",
  PAID: "Paid in full",
  REFUNDED: "Refunded",
  CANCELED: "Canceled",
  VOIDED: "Voided",
} as const;

/** Older delivery tracking (kept on records; delivery is now part of the production stage). */
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
export const DELIVERY_METHODS = ["WHITE_GLOVE", "PICKUP", "OTHER"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];
export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = { WHITE_GLOVE: "White glove delivery", PICKUP: "Customer pickup", OTHER: "Other" };
export function deliveryMethodLabel(m: string | null | undefined) {
  return m && m in DELIVERY_METHOD_LABELS ? DELIVERY_METHOD_LABELS[m as DeliveryMethod] : null;
}

/** Recorded by an admin (never creates anything in Stripe). */
export const MANUAL_PAYMENT_METHODS = ["CASH", "CHECK", "BANK_TRANSFER", "OTHER"] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS = {
  STRIPE_ONLINE: "Stripe online",
  STRIPE_TERMINAL: "Card in person (Stripe Terminal)",
  CASH: "Cash",
  CHECK: "Check",
  BANK_TRANSFER: "Bank transfer",
  OTHER: "Other",
} as const;
export const PAYMENT_TYPES = ["DEPOSIT", "FINAL_BALANCE", "PARTIAL_PAYMENT", "ADDITIONAL_PAYMENT", "OTHER"] as const;
export type PaymentTypeValue = (typeof PAYMENT_TYPES)[number];
export const PAYMENT_TYPE_LABELS: Record<PaymentTypeValue, string> = {
  DEPOSIT: "Deposit",
  FINAL_BALANCE: "Final balance",
  PARTIAL_PAYMENT: "Partial payment",
  ADDITIONAL_PAYMENT: "Additional payment",
  OTHER: "Payment",
};
export const PAYMENT_STATUS_LABELS = {
  SUCCEEDED: "Succeeded",
  PENDING: "Pending",
  FAILED: "Failed",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partially refunded",
  VOIDED: "Voided",
  RETURNED: "Returned",
} as const;
/** Checks read Pending → Cleared (or Returned); everything else uses the plain labels. */
export function paymentStatusLabel(method: string, status: keyof typeof PAYMENT_STATUS_LABELS) {
  if (method === "CHECK" && status === "SUCCEEDED") return "Cleared";
  return PAYMENT_STATUS_LABELS[status];
}
/** Check lifecycle (recorded as PENDING until marked cleared). */
export const CHECK_STATUSES = ["PENDING", "SUCCEEDED"] as const;

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
  VOIDED: "red",
  BALANCE_DUE: "amber",
  ORDER_CONFIRMED: "blue",
  IN_PRODUCTION: "violet",
  RETURNED: "red",
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
  PARTIALLY_REFUNDED: "amber",
};

export function statusTone(status: string): Tone {
  return TONES[status] ?? "neutral";
}

const ALL_LABELS: Record<string, string> = {
  ...LEGACY_PRODUCTION_LABELS,
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
