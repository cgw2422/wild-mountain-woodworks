import "server-only";
import { getClientIp } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";

export const HONEYPOT_FIELD = "company_website";
export const STARTED_AT_FIELD = "form_started_at";

/**
 * Lightweight abuse protection for public forms:
 * - honeypot field that humans never see
 * - minimum fill time (bots submit instantly)
 * - per-IP rate limit, stored in PostgreSQL
 *
 * Returns "bot" to silently accept-and-drop, "limited" when rate limited, or
 * "ok".
 */
export async function checkPublicSubmission(
  fd: FormData,
  formKey: string,
  limits: { perWindow: number; windowSeconds: number } = { perWindow: 5, windowSeconds: 600 },
): Promise<"ok" | "bot" | "limited"> {
  const honeypot = fd.get(HONEYPOT_FIELD);
  if (typeof honeypot === "string" && honeypot.trim() !== "") return "bot";

  const startedAt = Number(fd.get(STARTED_AT_FIELD));
  if (Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < 2500) return "bot";

  const ip = await getClientIp();
  const res = await rateLimit(`form:${formKey}:${ip}`, limits.perWindow, limits.windowSeconds);
  return res.allowed ? "ok" : "limited";
}
