/**
 * Product sale prices. While a product's sale is enabled and inside its
 * window (`startsAt <= now < endsAt`, either bound optional), the sale price
 * replaces the product's base (regular) price — option modifiers and add-ons
 * are unchanged. Pure and client-safe; the server always decides whether a
 * sale is active using its own clock. The discount percentage is derived,
 * never stored.
 */

export interface SaleFields {
  basePriceCents: number | null;
  saleEnabled?: boolean | null;
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
}

/**
 * Where a product's sale stands at `now`:
 * - "none": no sale price; "off": a sale price is saved but the sale is disabled
 * - "invalid": enabled but not below the regular price (never applied)
 * - "scheduled" / "active" / "ended": by date window
 */
export type SaleStatus = "none" | "off" | "invalid" | "scheduled" | "active" | "ended";

export function saleStatus(p: SaleFields, now: Date = new Date()): SaleStatus {
  if (p.salePriceCents == null) return "none";
  // Records without the flag (older fixtures) are treated as enabled.
  if (p.saleEnabled === false) return "off";
  if (p.basePriceCents == null || p.salePriceCents <= 0 || p.salePriceCents >= p.basePriceCents) return "invalid";
  if (p.saleStartsAt && now < p.saleStartsAt) return "scheduled";
  if (p.saleEndsAt && now >= p.saleEndsAt) return "ended";
  return "active";
}

/** The sale in effect at `now`, or null. */
export function activeSale(p: SaleFields, now: Date = new Date()): ActiveSale | null {
  if (saleStatus(p, now) !== "active") return null;
  return {
    priceCents: p.salePriceCents!,
    regularPriceCents: p.basePriceCents!,
    endsAt: p.saleEndsAt?.toISOString() ?? null,
    label: p.saleLabel?.trim() || null,
  };
}

/** Whole percent off, rounded down so it never overstates the discount. */
export function percentOff(regularCents: number, saleCents: number): number {
  if (regularCents <= 0 || saleCents >= regularCents) return 0;
  return Math.floor(((regularCents - saleCents) / regularCents) * 100);
}

/** "Sale · 30% off" / "Fall Sale · 30% off" (styled uppercase where shown). */
export function saleCaption(label: string | null | undefined, pct: number): string {
  const name = label?.trim() || "Sale";
  return pct > 0 ? `${name} · ${pct}% off` : name;
}

const PERCENT = /^\s*(\d{1,2}(?:\.\d+)?)\s*%\s*$/;

/**
 * Parse what the owner typed as a sale price: dollars ("979", "1,095.50") or
 * a percent off the regular price ("30%", rounded to the whole dollar).
 * Shared by the admin preview and the authoritative server validation.
 */
export function parseSaleAmount(raw: string, regularCents: number | null): { cents: number } | { error: string } | null {
  const text = raw.trim();
  if (!text) return null;
  if (regularCents == null) return { error: "Set a regular price before adding a sale price." };
  let cents: number;
  const pct = PERCENT.exec(text);
  if (pct) {
    const p = Number(pct[1]);
    if (!(p > 0 && p < 100)) return { error: "Enter a percentage between 1% and 99%." };
    cents = Math.round((regularCents * (100 - p)) / 10000) * 100;
  } else {
    const cleaned = text.replace(/[$,\s]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { error: "Enter an amount like 979, or a percentage like 30%." };
    const [whole, frac = ""] = cleaned.split(".");
    cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  }
  if (cents <= 0) return { error: "The sale price must be more than $0." };
  if (cents >= regularCents) return { error: "The sale price must be lower than the regular price." };
  return { cents };
}
