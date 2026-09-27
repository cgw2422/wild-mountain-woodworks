import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "wm_admin_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
export const SESSION_REFRESH_MS = 1000 * 60 * 60 * 24; // extend at most daily

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
