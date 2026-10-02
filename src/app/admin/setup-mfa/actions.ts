"use server";

import { headers } from "next/headers";
import QRCode from "qrcode";
import { z } from "zod";
import { isAPIError } from "better-auth/api";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { getAuth } from "@/lib/auth/auth";
import { markSecondFactorVerified, requireSignedIn } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";

export type EnrollStart = { ok: true; qr: string; secret: string; backupCodes: string[] } | { ok: false; error: string };

/**
 * Begin (or restart) authenticator enrolment. Requires the current password.
 * Returns the QR code, the manual-entry key and the backup codes — the only
 * time the backup codes are ever shown.
 */
export async function startEnrollment(password: string): Promise<EnrollStart> {
  const { admin, mfaEnrolled } = await requireSignedIn();
  if (mfaEnrolled) return { ok: false, error: "Two-factor authentication is already set up." };
  if (!(await rateLimit(`mfa-enroll:${admin.id}`, 10, 15 * 60)).allowed) return { ok: false, error: "Too many attempts. Please wait 15 minutes." };
  const pw = z.string().min(1).max(200).safeParse(password);
  if (!pw.success) return { ok: false, error: "Enter your password." };
  try {
    const res = (await getAuth().api.enableTwoFactor({ body: { password: pw.data }, headers: await headers() })) as { totpURI?: string; backupCodes?: string[] };
    if (!res.totpURI || !res.backupCodes) return { ok: false, error: "Two-factor setup couldn't be started. Please try again." };
    const secret = new URL(res.totpURI).searchParams.get("secret") ?? "";
    const qr = await QRCode.toDataURL(res.totpURI, { margin: 1, width: 240, errorCorrectionLevel: "M" });
    return { ok: true, qr, secret, backupCodes: res.backupCodes };
  } catch (error) {
    if (isAPIError(error)) return { ok: false, error: "That password isn't correct." };
    logger.error("Two-factor enrolment failed to start", { error });
    return { ok: false, error: "Two-factor setup couldn't be started. Please try again." };
  }
}

/** Confirm enrolment with a code from the app. Rotates the session on success. */
export async function confirmEnrollment(code: string): Promise<{ ok: boolean; error?: string }> {
  const { admin, mfaEnrolled } = await requireSignedIn();
  if (mfaEnrolled) return { ok: true };
  if (!(await rateLimit(`mfa-confirm:${admin.id}`, 10, 15 * 60)).allowed) return { ok: false, error: "Too many attempts. Please wait 15 minutes." };
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false, error: "Enter the 6-digit code from your authenticator app." };
  let token: string | undefined;
  try {
    token = ((await getAuth().api.verifyTOTP({ body: { code: clean }, headers: await headers() })) as { token?: string }).token;
  } catch (error) {
    if (!isAPIError(error)) logger.error("Two-factor enrolment failed to confirm", { error });
    return { ok: false, error: "That code isn't right. Make sure your phone's clock is set automatically and try the newest code." };
  }
  await markSecondFactorVerified({ token, sessionId: token ? undefined : admin.sessionId }, admin.id);
  await logActivity("admin.mfa_enabled", `${admin.name} set up two-factor authentication`, { actorId: admin.id, entityType: "admin", entityId: admin.id });
  return { ok: true };
}
