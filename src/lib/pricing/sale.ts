/**
 * Product sale prices. A sale replaces the product's base price — option
 * modifiers and add-ons are unchanged — while `startsAt <= now < endsAt`
 * (either bound may be open). Pure and client-safe; the server always
 * decides whether a sale is active using its own clock.
 */

export interface SaleFields {
  basePriceCents: number | null;
  salePriceCents?: number | null;
  saleStartsAt?: Date | null;
  saleEndsAt?: Date | null;
}

export interface ActiveSale {
  priceCents: number;
  regularPriceCents: number;
  /** ISO timestamp the sale ends (exclusive), or null when open-ended. */
  endsAt: string | null;
}

export type SaleStatus = "none" | "scheduled" | "active" | "ended" | "invalid";

/** Where a product's sale stands at `now`. "invalid": the sale is not below the base price, so it is ignored. */
export function saleStatus(p: SaleFields, now: Date = new Date()): SaleStatus {
  if (p.salePriceCents == null) return "none";
  if (p.basePriceCents == null || p.salePriceCents < 0 || p.salePriceCents >= p.basePriceCents) return "invalid";
  if (p.saleStartsAt && now < p.saleStartsAt) return "scheduled";
  if (p.saleEndsAt && now >= p.saleEndsAt) return "ended";
  return "active";
}

/** The sale in effect at `now`, or null. */
export function activeSale(p: SaleFields, now: Date = new Date()): ActiveSale | null {
  if (saleStatus(p, now) !== "active") return null;
  return { priceCents: p.salePriceCents!, regularPriceCents: p.basePriceCents!, endsAt: p.saleEndsAt?.toISOString() ?? null };
}

/** "20% off" — whole percent, rounded down so it never overstates the discount. */
export function percentOff(regularCents: number, saleCents: number): number {
  if (regularCents <= 0 || saleCents >= regularCents) return 0;
  return Math.floor(((regularCents - saleCents) / regularCents) * 100);
}
