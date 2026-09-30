import { AdminError } from "@/lib/admin/action";
import { parseDollarsToCents } from "@/lib/money";
import { siteDayStart } from "@/lib/site-time";

export interface SaleInput {
  basePriceCents: number | null;
  /** "1095", "1,095.00" or a percentage off the base price like "20%" (rounded to the dollar). */
  salePrice: string;
  /** "YYYY-MM-DD" in the site time zone, or blank for "starts now". */
  saleStarts: string;
  /** "YYYY-MM-DD" (last day of the sale, inclusive), or blank for "until removed". */
  saleEnds: string;
}

export interface SaleFields {
  salePriceCents: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
}

const PERCENT = /^\s*(\d{1,2}(?:\.\d+)?)\s*%\s*$/;

/**
 * Validate the sale fields server-side. A blank sale price clears the sale.
 * Dates are whole days in the site time zone: the sale runs from local
 * midnight on the start day until local midnight after the end day.
 */
export function parseSaleInput(input: SaleInput): SaleFields {
  const errors: Record<string, string> = {};
  const raw = input.salePrice.trim();
  if (!raw) return { salePriceCents: null, saleStartsAt: null, saleEndsAt: null };

  const base = input.basePriceCents;
  let cents: number | null = null;
  const pct = PERCENT.exec(raw);
  if (base == null) {
    errors.salePrice = "Set a base price before adding a sale price.";
  } else if (pct) {
    const p = Number(pct[1]);
    if (!(p > 0 && p < 100)) errors.salePrice = "Enter a percentage between 1% and 99%.";
    // Rounded to the whole dollar: 20% off $1,295 → $1,036.
    else cents = Math.round((base * (100 - p)) / 10000) * 100;
  } else {
    const parsed = parseDollarsToCents(raw);
    if (parsed == null || Number.isNaN(parsed)) errors.salePrice = "Enter an amount like 995, or a percentage like 20%.";
    else if (parsed <= 0) errors.salePrice = "The sale price must be more than $0.";
    else cents = parsed;
  }
  if (cents != null && base != null && cents >= base) errors.salePrice = "The sale price must be lower than the base price.";

  const startDay = input.saleStarts.trim();
  const endDay = input.saleEnds.trim();
  const saleStartsAt = startDay ? siteDayStart(startDay) : null;
  const saleEndsAt = endDay ? siteDayStart(endDay, 1) : null;
  if (startDay && !saleStartsAt) errors.saleStarts = "Choose a valid date.";
  if (endDay && !saleEndsAt) errors.saleEnds = "Choose a valid date.";
  if (saleStartsAt && saleEndsAt && saleEndsAt <= saleStartsAt) errors.saleEnds = "The end date must be on or after the start date.";

  if (Object.keys(errors).length) throw new AdminError("Please correct the highlighted fields.", errors);
  return { salePriceCents: cents, saleStartsAt, saleEndsAt };
}
