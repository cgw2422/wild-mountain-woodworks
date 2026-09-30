/**
 * Product sale prices. While a product's sale is enabled and inside its
 * window (`startsAt <= now < endsAt`, either bound optional), the sale price
 * replaces the product's base (regular) price — option modifiers and add-ons
 * are unchanged. Pure and client-safe; the server always decides whether a
 * sale is active using its own clock.
 *
 * Two kinds of sale, remembered as entered:
 * - PERCENT ("30%"): the entered percentage is the source of truth. The sale
 *   price is derived from the CURRENT regular price and rounded to the whole
 *   dollar (half up), and the advertised discount is always the entered
 *   percentage — never recalculated from the rounded price ($225 at 30% →
 *   $157.50 → $158, advertised "30% off", not 29%).
 * - FIXED_PRICE ("$158"): the sale price is the source of truth and the
 *   advertised discount is derived from the two prices (rounded down).
 */

export type SaleKind = "PERCENT" | "FIXED_PRICE";

export interface SaleFields {
  basePriceCents: number | null;
  saleEnabled?: boolean | null;
  /** Missing on older records/fixtures: a stored sale price is then FIXED_PRICE. */
  saleType?: SaleKind | null;
  /** PERCENT only: hundredths of a percent (3000 = 30%). */
  salePercentBps?: number | null;
  /** FIXED_PRICE only. */
  salePriceCents?: number | null;
  saleStartsAt?: Date | null;
  saleEndsAt?: Date | null;
  saleLabel?: string | null;
}

export interface ActiveSale {
  priceCents: number;
  regularPriceCents: number;
  /** ISO timestamp the sale ends (exclusive), or null when open-ended. */
  endsAt: string | null;
  /** Custom label ("Fall Sale"), or null for the default "Sale". */
  label: string | null;
  /** The entered percentage (e.g. 30 or 12.5) for PERCENT sales; null for FIXED_PRICE. */
  percent: number | null;
}

/**
 * Where a product's sale stands at `now`:
 * - "none": no sale set; "off": a sale is saved but switched off
 * - "invalid": enabled but not below the regular price (never applied)
 * - "scheduled" / "active" / "ended": by date window
 */
export type SaleStatus = "none" | "off" | "invalid" | "scheduled" | "active" | "ended";

/** How a stored sale was entered, or null when there is none. */
export function saleKind(p: SaleFields): SaleKind | null {
  if (p.saleType) return p.saleType;
  return p.salePriceCents != null ? "FIXED_PRICE" : null;
}

/** Whole dollars, half up, from an exact cents amount given as a fraction num/den. */
function roundToDollar(num: number, den: number): number {
  return Math.floor((num + den * 50) / (den * 100)) * 100;
}

/** The exact (unrounded) sale price in cents for a percent sale; may be fractional. */
export function exactPercentSalePrice(regularCents: number, bps: number): number {
  return (regularCents * (10_000 - bps)) / 10_000;
}

/** A percent sale's price: regular × (1 − percent), rounded to the whole dollar (half up). Integer math. */
export function percentSalePrice(regularCents: number, bps: number): number {
  return roundToDollar(regularCents * (10_000 - bps), 10_000);
}

/** The sale price this product's sale would charge against its current regular price (null if none/invalid). */
export function salePriceFor(p: SaleFields): number | null {
  const kind = saleKind(p);
  if (kind === "PERCENT") {
    const bps = p.salePercentBps;
    if (p.basePriceCents == null || bps == null || bps <= 0 || bps >= 10_000) return null;
    return percentSalePrice(p.basePriceCents, bps);
  }
  if (kind === "FIXED_PRICE") return p.salePriceCents ?? null;
  return null;
}

export function saleStatus(p: SaleFields, now: Date = new Date()): SaleStatus {
  const kind = saleKind(p);
  if (!kind) return "none";
  // Records without the flag (older fixtures) are treated as enabled.
  if (p.saleEnabled === false) return "off";
  const price = salePriceFor(p);
  if (p.basePriceCents == null || price == null || price <= 0 || price >= p.basePriceCents) return "invalid";
  if (p.saleStartsAt && now < p.saleStartsAt) return "scheduled";
  if (p.saleEndsAt && now >= p.saleEndsAt) return "ended";
  return "active";
}

/** The sale in effect at `now`, or null. */
export function activeSale(p: SaleFields, now: Date = new Date()): ActiveSale | null {
  if (saleStatus(p, now) !== "active") return null;
  return {
    priceCents: salePriceFor(p)!,
    regularPriceCents: p.basePriceCents!,
    endsAt: p.saleEndsAt?.toISOString() ?? null,
    label: p.saleLabel?.trim() || null,
    percent: saleKind(p) === "PERCENT" ? p.salePercentBps! / 100 : null,
  };
}

/** FIXED_PRICE sales: whole percent off, rounded down so it never overstates the discount. */
export function percentOff(regularCents: number, saleCents: number): number {
  if (regularCents <= 0 || saleCents >= regularCents) return 0;
  return Math.floor(((regularCents - saleCents) / regularCents) * 100);
}

/** 30 → "30", 12.5 → "12.5", 12.25 → "12.25". */
export function formatPercent(pct: number): string {
  return String(Math.round(pct * 100) / 100);
}

/** "Sale · 30% off" / "Fall Sale · 12.5% off" (styled uppercase where shown). */
export function saleCaption(label: string | null | undefined, pct: number): string {
  const name = label?.trim() || "Sale";
  return pct > 0 ? `${name} · ${formatPercent(pct)}% off` : name;
}

const PERCENT = /^\s*(\d{1,2}(?:\.\d{1,2})?)\s*%\s*$/;

export type SaleAmount =
  | { kind: "PERCENT"; bps: number; percent: number; cents: number; exactCents: number }
  | { kind: "FIXED_PRICE"; cents: number };

/**
 * Parse what the owner typed: dollars ("158", "1,095.50") → FIXED_PRICE, or a
 * percent off the regular price ("30%", "12.5%") → PERCENT, with the rounded
 * sale price for preview/validation. Shared by the admin preview and the
 * authoritative server validation.
 */
export function parseSaleAmount(raw: string, regularCents: number | null): SaleAmount | { error: string } | null {
  const text = raw.trim();
  if (!text) return null;
  if (regularCents == null) return { error: "Set a regular price before adding a sale price." };
  const pct = PERCENT.exec(text);
  let result: SaleAmount;
  if (pct) {
    const bps = Math.round(Number(pct[1]) * 100);
    if (!(bps > 0 && bps < 10_000)) return { error: "Enter a percentage between 1% and 99%." };
    result = { kind: "PERCENT", bps, percent: bps / 100, cents: percentSalePrice(regularCents, bps), exactCents: exactPercentSalePrice(regularCents, bps) };
  } else if (text.includes("%")) {
    return { error: "Enter a percentage between 1% and 99%, with up to two decimals." };
  } else {
    const cleaned = text.replace(/[$,\s]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { error: "Enter an amount like 979, or a percentage like 30%." };
    const [whole, frac = ""] = cleaned.split(".");
    result = { kind: "FIXED_PRICE", cents: Number(whole) * 100 + Number(frac.padEnd(2, "0")) };
  }
  if (result.cents <= 0) return { error: "The sale price must be more than $0." };
  if (result.cents >= regularCents) return { error: "The sale price must be lower than the regular price." };
  return result;
}

/** The sale field's value for the editor: "30%" for percent sales, dollars for fixed. */
export function saleInputValue(p: SaleFields): string {
  const kind = saleKind(p);
  if (kind === "PERCENT" && p.salePercentBps != null) return `${formatPercent(p.salePercentBps / 100)}%`;
  if (kind === "FIXED_PRICE" && p.salePriceCents != null) {
    const c = p.salePriceCents;
    return c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2);
  }
  return "";
}
