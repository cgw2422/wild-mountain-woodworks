/**
 * Sitewide announcement bar — pure helpers shared by the site, the admin
 * preview and the server validation. Client-safe.
 */

export interface AnnouncementWindow {
  enabled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

export type AnnouncementStatus = "off" | "scheduled" | "live" | "ended";

/** Where an announcement stands at `now` (end is exclusive). */
export function announcementStatus(a: AnnouncementWindow, now: Date = new Date()): AnnouncementStatus {
  if (!a.enabled) return "off";
  if (a.startsAt && now < a.startsAt) return "scheduled";
  if (a.endsAt && now >= a.endsAt) return "ended";
  return "live";
}

/* ------------------------------------------------------------ dismissal */

/** Cookie remembering which promotions a visitor closed (not sensitive; read by the server to avoid a flash). */
export const DISMISS_COOKIE = "wm_promo_dismissed";
const MAX_REMEMBERED = 10;

/**
 * Identifies one promotion's wording. A new announcement — or a change to the
 * message or link, which bumps `revision` — gets a new key, so it appears
 * again even for visitors who closed an earlier one.
 */
export function dismissKey(a: { id: string; revision: number }) {
  return `${a.id}.${a.revision}`;
}

export function parseDismissed(cookie: string | undefined | null): string[] {
  if (!cookie) return [];
  let raw = cookie;
  try {
    raw = decodeURIComponent(cookie);
  } catch {
    /* keep raw */
  }
  return raw.split("~").filter((k) => /^[a-z0-9]{1,40}\.\d{1,6}$/i.test(k)).slice(-MAX_REMEMBERED);
}

export function withDismissed(cookie: string | undefined | null, key: string): string {
  const keys = parseDismissed(cookie).filter((k) => k !== key);
  return [...keys, key].slice(-MAX_REMEMBERED).join("~");
}

/* ------------------------------------------------------------ colors */

export const ANNOUNCEMENT_PRESETS = [
  { name: "Mountain Charcoal", background: "#1f1e1c", text: "#f7f3ec" },
  { name: "Muted Bronze", background: "#7a5c36", text: "#f7f3ec" },
  { name: "Walnut", background: "#5a3e2b", text: "#f7f3ec" },
  { name: "Warm Stone", background: "#e3dbce", text: "#1f1e1c" },
] as const;

export const DEFAULT_ANNOUNCEMENT_COLORS = ANNOUNCEMENT_PRESETS[0];
export const MIN_ANNOUNCEMENT_CONTRAST = 4.5;

export function isHexColor(v: string) {
  return /^#[0-9a-f]{6}$/i.test(v);
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio between two "#rrggbb" colors (1–21). */
export function contrastRatio(a: string, b: string) {
  if (!isHexColor(a) || !isHexColor(b)) return 1;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/* ------------------------------------------------------------ links */

/**
 * Accept only site paths ("/furniture/sale") and http(s) URLs, so an admin
 * can't (accidentally or otherwise) publish a javascript: or data: link.
 * Returns the normalised URL, or null when it isn't allowed.
 */
export function safeLinkUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.startsWith("/")) return v.startsWith("//") || v.includes("\\") || /\s/.test(v) ? null : v;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function isExternalLink(url: string) {
  return !url.startsWith("/");
}
