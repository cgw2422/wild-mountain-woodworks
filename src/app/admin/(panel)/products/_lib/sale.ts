import { AdminError } from "@/lib/admin/action";
import { parseSaleAmount } from "@/lib/pricing/sale";
import { siteDayStart } from "@/lib/site-time";

export interface SaleInput {
  /** The validated regular (base) price being saved alongside. */
  basePriceCents: number | null;
  saleEnabled: boolean;
  saleLabel: string;
  /** "979", "1,095.00" or a percentage off the regular price like "30%" (rounded to the dollar). */
  salePrice: string;
  /** "YYYY-MM-DD" in the site time zone, or blank for "starts now". */
  saleStarts: string;
  /** "YYYY-MM-DD" (last day of the sale, inclusive), or blank for "until switched off". */
  saleEnds: string;
}

export interface SaleFields {
  saleEnabled: boolean;
  saleLabel: string | null;
  salePriceCents: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
}

/**
 * Validate the sale fields server-side (never trust the browser). A sale
 * price is validated even while the sale is switched off, so a bad value
 * can't be saved now and switched on later. A blank sale price clears the
 * sale. Dates are whole days in the site time zone: the sale runs from local
 * midnight on the start day until local midnight after the end day.
 */
export function parseSaleInput(input: SaleInput): SaleFields {
  const errors: Record<string, string> = {};
  const saleLabel = input.saleLabel.trim().replace(/\s+/g, " ") || null;
  if (saleLabel && saleLabel.length > 40) errors.saleLabel = "Keep the label under 40 characters.";

  const amount = parseSaleAmount(input.salePrice, input.basePriceCents);
  if (amount == null) {
    if (input.saleEnabled) errors.salePrice = "Enter a sale price, or switch the sale off.";
    if (Object.keys(errors).length) throw new AdminError("Please correct the highlighted fields.", errors);
    return { saleEnabled: false, saleLabel, salePriceCents: null, saleStartsAt: null, saleEndsAt: null };
  }
  if ("error" in amount) errors.salePrice = amount.error;

  const startDay = input.saleStarts.trim();
  const endDay = input.saleEnds.trim();
  const saleStartsAt = startDay ? siteDayStart(startDay) : null;
  const saleEndsAt = endDay ? siteDayStart(endDay, 1) : null;
  if (startDay && !saleStartsAt) errors.saleStarts = "Choose a valid date.";
  if (endDay && !saleEndsAt) errors.saleEnds = "Choose a valid date.";
  if (saleStartsAt && saleEndsAt && saleEndsAt <= saleStartsAt) errors.saleEnds = "The end date must be on or after the start date.";

  if (Object.keys(errors).length || !("cents" in amount)) throw new AdminError("Please correct the highlighted fields.", errors);
  return { saleEnabled: input.saleEnabled, saleLabel, salePriceCents: amount.cents, saleStartsAt, saleEndsAt };
}
