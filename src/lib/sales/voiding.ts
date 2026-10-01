import { SalesError } from "./errors";
import { VOID_REASONS } from "./status";

/**
 * Quotes, invoices, payments and orders are permanent records: they are
 * voided (with who/when/why), never deleted. The database refuses deletes too
 * (migration 20261010000000_void_not_delete).
 */

/** "Pricing mistake" or "Other — customer moved"; "Other" needs details. */
export function voidReasonText(reason: string, details: string | null | undefined): string {
  const r = reason.trim();
  const d = (details ?? "").trim().slice(0, 280);
  if (!(VOID_REASONS as readonly string[]).includes(r)) throw new SalesError("Choose a reason for voiding.", { reason: "Choose a reason." });
  if (r === "Other" && d.length < 3) throw new SalesError("Describe why it's being voided.", { details: "Add a short explanation." });
  return d ? `${r} — ${d}` : r;
}

export const VOIDED_QUOTE_MESSAGE = "This quote is no longer valid. Please contact us if you need an updated quote.";
