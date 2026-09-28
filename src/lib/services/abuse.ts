import "server-only";
import { getClientIp } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";

import { HONEYPOT_FIELD_NAME as HONEYPOT_FIELD, STARTED_AT_FIELD_NAME as STARTED_AT_FIELD } from "@/lib/validation/honeypot";

/**
 * Lightweight abuse protection for public forms:
 * - honeypot field that humans never see → silently accepted and dropped
 * - minimum fill time → the visitor is asked to submit again (never dropped,
 *   so a fast human using autofill can't lose their request)
 * - per-IP rate limit, stored in PostgreSQL
 */
export type SubmissionVerdict = "ok" | "bot" | "too-fast" | "limited";

export const MIN_FILL_MS = 1500;

export function isHoneypotTripped(fd: FormData) {
  const honeypot = fd.get(HONEYPOT_FIELD);
  return typeof honeypot === "string" && honeypot.trim() !== "";
}

export async function checkPublicSubmission(
  fd: FormData,
  formKey: string,
  limits: { perWindow: number; windowSeconds: number } = { perWindow: 5, windowSeconds: 600 },
): Promise<SubmissionVerdict> {
  if (isHoneypotTripped(fd)) return "bot";

  const startedAt = Number(fd.get(STARTED_AT_FIELD));
  if (Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < MIN_FILL_MS) return "too-fast";

  const ip = await getClientIp();
  const res = await rateLimit(`form:${formKey}:${ip}`, limits.perWindow, limits.windowSeconds);
  return res.allowed ? "ok" : "limited";
}
