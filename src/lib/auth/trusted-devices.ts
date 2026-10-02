import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { describeUserAgent } from "./user-agent";

/**
 * Trusted devices ("Trust this device for 30 days").
 *
 * After a successful password AND authenticator code, an admin may trust the
 * browser. Later sign-ins on it still need the password; only the code is
 * skipped, and only while the trust is valid. Better Auth's own trust-device
 * option isn't used because it stores the identifier in plain text, slides
 * the 30 days forward on every sign-in and keeps no per-device record to list
 * or revoke; this module replaces it, and the sign-in itself still completes
 * through Better Auth (./trusted-device-plugin.ts).
 *
 * - Token: 32 random bytes (crypto.randomBytes), base64url, versioned "v1.".
 *   It lives only in the browser cookie; the database stores its SHA-256
 *   hash, so a database leak can't be replayed as a cookie.
 * - Cookie: HttpOnly, SameSite=Strict, Secure + "__Secure-" in production,
 *   scoped to /admin/login (the only place it is read), and expiring with the
 *   record. It carries nothing but the token.
 * - Expiry: fixed at creation (30 days) and never extended by use.
 * - Valid only for the admin it was created for, while the record is neither
 *   revoked nor expired and the account is active with two-factor on. IP
 *   addresses are recorded for the audit trail only, never checked.
 * - Revoked automatically on password, two-factor and account changes (app
 *   code here plus database triggers as a backstop), and by the admin.
 */

export const TRUSTED_DEVICE_DAYS = 30;
export const TRUSTED_DEVICE_MAX_AGE_SECONDS = TRUSTED_DEVICE_DAYS * 24 * 60 * 60;
/** The cookie is only ever read by the sign-in server action, which posts to the login page. */
export const TRUSTED_DEVICE_COOKIE_PATH = "/admin/login";

const TOKEN_PATTERN = /^v1\.[A-Za-z0-9_-]{43}$/;

export function trustedDeviceCookieName() {
  return process.env.NODE_ENV === "production" ? "__Secure-wm_admin.trusted_device" : "wm_admin.trusted_device";
}

export function hashTrustedDeviceToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newTrustedDeviceToken() {
  return `v1.${randomBytes(32).toString("base64url")}`;
}

export function trustedDeviceCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: TRUSTED_DEVICE_COOKIE_PATH,
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
  };
}

export type TrustedDeviceRejection = "missing" | "malformed" | "unknown" | "other_user" | "revoked" | "expired" | "inactive";
export type TrustedDeviceCheck = { ok: true; device: { id: string; label: string; userId: string } } | { ok: false; reason: TrustedDeviceRejection; deviceId?: string };

/**
 * Is this cookie token a valid trusted device for `userId`? Default deny:
 * anything other than a known, unrevoked, unexpired record belonging to this
 * active, two-factor-enrolled admin is rejected.
 */
export async function checkTrustedDevice(token: string | null | undefined, userId: string, now = new Date()): Promise<TrustedDeviceCheck> {
  if (!token) return { ok: false, reason: "missing" };
  if (!TOKEN_PATTERN.test(token)) return { ok: false, reason: "malformed" };
  const device = await prisma.adminTrustedDevice.findUnique({
    where: { tokenHash: hashTrustedDeviceToken(token) },
    select: { id: true, label: true, userId: true, expiresAt: true, revokedAt: true, user: { select: { active: true, twoFactorEnabled: true } } },
  });
  if (!device) return { ok: false, reason: "unknown" };
  if (device.userId !== userId) return { ok: false, reason: "other_user" };
  if (device.revokedAt) return { ok: false, reason: "revoked", deviceId: device.id };
  if (device.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired", deviceId: device.id };
  if (!device.user.active || !device.user.twoFactorEnabled) return { ok: false, reason: "inactive", deviceId: device.id };
  return { ok: true, device: { id: device.id, label: device.label, userId: device.userId } };
}

/** The raw token from this request's cookie (only sent to /admin/login). */
export async function readTrustedDeviceCookie() {
  return (await cookies()).get(trustedDeviceCookieName())?.value ?? null;
}

export async function clearTrustedDeviceCookie() {
  (await cookies()).set(trustedDeviceCookieName(), "", { ...trustedDeviceCookieOptions(new Date(0)), maxAge: 0 });
}

/**
 * Trust this browser for `userId` (call only after the password and an
 * authenticator code both succeeded). A trust this browser already held is
 * revoked — its cookie is being replaced. Returns the new record; the raw
 * token goes only into the cookie.
 */
export async function trustThisDevice(userId: string, ctx: { userAgent: string | null; ip: string | null }) {
  const previous = await readTrustedDeviceCookie();
  if (previous && TOKEN_PATTERN.test(previous)) {
    await prisma.adminTrustedDevice.updateMany({
      where: { tokenHash: hashTrustedDeviceToken(previous), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "replaced" },
    });
  }
  const token = newTrustedDeviceToken();
  const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_MAX_AGE_SECONDS * 1000);
  const userAgent = ctx.userAgent?.slice(0, 300) || null;
  const device = await prisma.adminTrustedDevice.create({
    data: {
      userId,
      tokenHash: hashTrustedDeviceToken(token),
      label: describeUserAgent(userAgent),
      userAgent,
      firstSeenIp: ctx.ip,
      lastSeenIp: ctx.ip,
      expiresAt,
    },
    select: { id: true, label: true, expiresAt: true },
  });
  (await cookies()).set(trustedDeviceCookieName(), token, trustedDeviceCookieOptions(expiresAt));
  return device;
}

/** Record a sign-in on a trusted device. The expiry is NOT extended. */
export async function markTrustedDeviceUsed(deviceId: string, ip: string | null) {
  await prisma.adminTrustedDevice.update({ where: { id: deviceId }, data: { lastUsedAt: new Date(), lastSeenIp: ip } });
}

/** Devices that currently skip the code for this admin. */
export function activeTrustedDevicesWhere(userId: string, now = new Date()) {
  return { userId, revokedAt: null, expiresAt: { gt: now } };
}

/** Revoke one of an admin's devices. Returns the device (or null if it wasn't active). */
export async function revokeTrustedDevice(userId: string, deviceId: string, revokedById: string) {
  const device = await prisma.adminTrustedDevice.findFirst({ where: { id: deviceId, ...activeTrustedDevicesWhere(userId) }, select: { id: true, label: true } });
  if (!device) return null;
  await prisma.adminTrustedDevice.update({ where: { id: device.id }, data: { revokedAt: new Date(), revokedReason: "revoked", revokedById } });
  return device;
}

export type TrustedDeviceRevokeReason =
  | "revoked_all"
  | "password_changed"
  | "password_reset"
  | "two_factor_changed"
  | "account_disabled"
  | "signed_out_everywhere";

/**
 * Revoke every trusted device for an admin. `since` (taken before the change
 * that triggered this) also counts devices the database triggers already
 * revoked, so the audit log reports the real number. Returns that count.
 */
export async function revokeAllTrustedDevices(userId: string, reason: TrustedDeviceRevokeReason, opts: { revokedById?: string | null; since?: Date } = {}) {
  const since = opts.since ?? new Date();
  await prisma.adminTrustedDevice.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason, revokedById: opts.revokedById ?? null },
  });
  return prisma.adminTrustedDevice.count({ where: { userId, revokedAt: { gte: new Date(since.getTime() - 1000) }, revokedReason: { notIn: ["replaced", "revoked"] } } });
}

export async function renameTrustedDevice(userId: string, deviceId: string, label: string) {
  const res = await prisma.adminTrustedDevice.updateMany({ where: { id: deviceId, ...activeTrustedDevicesWhere(userId) }, data: { label } });
  return res.count > 0;
}
