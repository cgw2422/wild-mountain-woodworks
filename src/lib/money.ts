/** All money is integer cents (USD). */
export function formatCents(cents: number, opts: { showZeroCents?: boolean } = {}): string {
  const dollars = cents / 100;
  const hasCents = cents % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents || opts.showZeroCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(dollars);
}

/** "+$150", "−$50", or "" for zero. */
export function formatModifier(cents: number): string {
  if (cents === 0) return "";
  const sign = cents > 0 ? "+" : "−";
  return `${sign}${formatCents(Math.abs(cents))}`;
}

/** Parse a user-entered dollar amount ("1,295.50", "$300") into cents. */
export function parseDollarsToCents(input: string | null | undefined): number | null {
  if (input == null) return null;
  const cleaned = String(input).replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return NaN;
  const negative = cleaned.startsWith("-");
  const [whole, frac = ""] = cleaned.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return negative ? -cents : cents;
}

export function centsToDollarInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = abs % 100 === 0 ? String(abs / 100) : (abs / 100).toFixed(2);
  return neg ? `-${s}` : s;
}
