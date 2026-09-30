/**
 * Calendar dates in the business's time zone (SITE_TIME_ZONE, an IANA name;
 * default America/New_York). Used where the owner picks a day — e.g. a sale
 * running "Oct 1 – Oct 14" starts at local midnight on Oct 1 and ends at local
 * midnight after Oct 14, whatever time zone the server runs in.
 */

const DEFAULT_TZ = "America/New_York";

export function siteTimeZone(): string {
  const tz = process.env.SITE_TIME_ZONE?.trim();
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

/** Offset (ms) of `tz` from UTC at instant `at`. */
function offsetMs(at: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local midnight at the start of "YYYY-MM-DD" (plus `addDays`), as a UTC instant. Null for an invalid date. */
export function siteDayStart(date: string, addDays = 0, tz = siteTimeZone()): Date | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  const guess = Date.UTC(y, mo - 1, d + addDays);
  // Two passes settle DST transitions.
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t);
}

/** "YYYY-MM-DD" of instant `at` in the site time zone (for <input type="date">). */
export function siteDateInput(at: Date | null | undefined, tz = siteTimeZone()): string {
  if (!at) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** "Oct 14" (or "Oct 14, 2027" outside the current year) in the site time zone. */
export function siteDateLabel(at: Date, tz = siteTimeZone(), now = new Date()): string {
  const sameYear = siteDateInput(at, tz).slice(0, 4) === siteDateInput(now, tz).slice(0, 4);
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(at);
}

/** Sale end dates are stored exclusive (midnight after the last day); this is the last day it applies. */
export function lastSaleDay(endsAt: Date): Date {
  return new Date(endsAt.getTime() - 1);
}
