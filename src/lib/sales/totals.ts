/**
 * Quote and invoice arithmetic. Pure and client-safe (the quote editor shows
 * live totals), but the server always recomputes with these same functions
 * before saving — totals typed or computed in the browser are never stored.
 *
 * All money is integer cents. Discount lines carry negative amounts.
 */

export const LINE_KINDS = ["PRODUCT", "ADDON", "CUSTOM", "DISCOUNT", "DELIVERY", "INSTALLATION", "FEE"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export const LINE_KIND_LABELS: Record<LineKind, string> = {
  PRODUCT: "Product",
  ADDON: "Add-on",
  CUSTOM: "Custom item",
  DISCOUNT: "Discount",
  DELIVERY: "Delivery",
  INSTALLATION: "Installation",
  FEE: "Other charge",
};

export const DEPOSIT_TYPES = ["NONE", "PERCENTAGE", "FIXED_AMOUNT"] as const;
export type DepositType = (typeof DEPOSIT_TYPES)[number];

/** Limits that keep integer math far from overflow and catch typos. */
export const MAX_LINE_QUANTITY = 999;
export const MAX_UNIT_PRICE_CENTS = 10_000_000; // $100,000 per unit
export const MAX_LINES = 100;

export interface LineInput {
  kind: LineKind;
  quantity: number;
  unitPriceCents: number;
  taxable?: boolean;
}

export interface Totals {
  subtotalCents: number;
  /** Positive magnitude of all discount lines. */
  discountCents: number;
  deliveryCents: number;
  otherChargesCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
  balanceCents: number;
}

export interface DepositInput {
  depositType: DepositType;
  depositPercentBps?: number | null;
  depositAmountCents?: number | null;
}

/** Discounts are always negative, everything else as entered. */
export function normalizeUnitPrice(kind: LineKind, unitPriceCents: number): number {
  const n = Math.trunc(unitPriceCents);
  return kind === "DISCOUNT" ? -Math.abs(n) : n;
}

export function lineTotal(line: Pick<LineInput, "kind" | "quantity" | "unitPriceCents">): number {
  return Math.trunc(line.quantity) * normalizeUnitPrice(line.kind, line.unitPriceCents);
}

/** Round-half-up of a non-negative integer ratio a / b. */
function roundHalfUpDiv(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

/**
 * Deposit for a total: a percentage (basis points, 5000 = 50%, rounded
 * half-up to the cent), a fixed amount (never more than the total), or none.
 */
export function depositFor(totalCents: number, d: DepositInput): number {
  if (totalCents <= 0) return 0;
  if (d.depositType === "PERCENTAGE") {
    const bps = Math.min(10_000, Math.max(0, Math.trunc(d.depositPercentBps ?? 0)));
    return roundHalfUpDiv(totalCents * bps, 10_000);
  }
  if (d.depositType === "FIXED_AMOUNT") {
    return Math.min(totalCents, Math.max(0, Math.trunc(d.depositAmountCents ?? 0)));
  }
  return 0;
}

export function computeTotals(lines: LineInput[], deposit: DepositInput, taxCents = 0): Totals {
  let subtotal = 0;
  let discount = 0;
  let delivery = 0;
  let other = 0;
  for (const line of lines) {
    const amount = lineTotal(line);
    switch (line.kind) {
      case "DISCOUNT":
        discount += -amount;
        break;
      case "DELIVERY":
        delivery += amount;
        break;
      case "INSTALLATION":
      case "FEE":
        other += amount;
        break;
      default:
        subtotal += amount;
    }
  }
  const tax = Math.max(0, Math.trunc(taxCents));
  const total = subtotal - discount + delivery + other + tax;
  const dep = depositFor(total, deposit);
  return {
    subtotalCents: subtotal,
    discountCents: discount,
    deliveryCents: delivery,
    otherChargesCents: other,
    taxCents: tax,
    totalCents: total,
    depositCents: dep,
    balanceCents: total - dep,
  };
}

/** "50%" / "33.33%" from basis points. */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, "")}%`;
}

/** Parse "50", "33.5", "12.25%" into basis points; NaN if invalid. */
export function parsePercentToBps(input: string | null | undefined): number {
  const cleaned = String(input ?? "").replace(/[%\s]/g, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cleaned)) return NaN;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
