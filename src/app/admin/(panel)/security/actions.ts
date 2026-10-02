"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAPIError } from "better-auth/api";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { AdminError, permittedAction, fd, ownerAction, type ActionResult } from "@/lib/admin/action";
import { getAuth } from "@/lib/auth/auth";
import { markSecondFactorVerified, requireAdmin, secondFactorFreshUntil, type CurrentAdmin } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { validatePasswordStrength } from "@/lib/auth/password";
import { createPasswordAdmin, setAdminPassword } from "@/lib/auth/accounts";
import { rateLimit } from "@/lib/rate-limit";
import { renameTrustedDevice, revokeAllTrustedDevices, revokeTrustedDevice, type TrustedDeviceRevokeReason } from "@/lib/auth/trusted-devices";

/**
 * Security & admin users. Your own account: password, two-factor, sessions.
 * Owner only (ownerAction): create admins, change roles, deactivate, reset
 * passwords/two-factor and sign accounts out everywhere — each of these needs
 * a second factor proven in the last 15 minutes (freshOwnerAction), because a
 * trusted device skips the code at sign-in. Every change is written to the
 * audit log; secrets never are.
 *
 * Trusted devices are revoked whenever the password, two-factor or account
 * status changes (here, and by database triggers as a backstop).
 */

const refresh = () => revalidatePath("/admin/security");
const str = (data: FormData, key: string) => (typeof data.get(key) === "string" ? String(data.get(key)) : "");

async function throttle(adminId: string, what: string) {
  if (!(await rateLimit(`security:${what}:${adminId}`, 10, 15 * 60)).allowed) throw new AdminError("Too many attempts. Please wait 15 minutes and try again.");
}

const REVOKE_REASONS: Record<TrustedDeviceRevokeReason, string> = {
  revoked_all: "revoked by the admin",
  password_changed: "password changed",
  password_reset: "password reset",
  two_factor_changed: "two-factor reset",
  account_disabled: "account deactivated",
  signed_out_everywhere: "signed out everywhere",
};

/** Revoke all of `target`'s trusted devices and audit it (when there were any). */
async function revokeDevices(actor: CurrentAdmin, target: { id: string; name: string }, reason: TrustedDeviceRevokeReason, since?: Date) {
  const count = await revokeAllTrustedDevices(target.id, reason, { revokedById: actor.id, since });
  if (count || reason === "revoked_all") {
    await logActivity("admin.trusted_devices_revoked", `All trusted devices for ${target.name} revoked — ${REVOKE_REASONS[reason]} (${count} device${count === 1 ? "" : "s"})`, {
      actorId: actor.id,
      entityType: "admin",
      entityId: target.id,
    });
  }
  return count;
}

const STEP_UP_REQUIRED = "For your security, confirm it's you with a code from your authenticator app (under “Confirm it's you” on this page), then try again.";

/** Owner-only AND a second factor proven in the last 15 minutes (step-up for account-security changes). */
function freshOwnerAction<Args extends unknown[]>(fn: (admin: CurrentAdmin, ...args: Args) => Promise<ActionResult | void>) {
  return ownerAction(async (admin, ...args: Args) => {
    if (!(await secondFactorFreshUntil(admin))) throw new AdminError(STEP_UP_REQUIRED);
    return fn(admin, ...args);
  });
}

/* Your account ---------------------------------------------------------------- */

/** "Confirm it's you": prove the second factor again (authenticator code) for owner security changes. */
export const confirmIdentity = permittedAction("own_account", async (admin, data: FormData) => {
  await throttle(admin.id, "step-up");
  const code = str(data, "code").replace(/\D/g, "");
  if (!/^\d{6}$/.test(code)) throw new AdminError("Enter the 6-digit code from your authenticator app.", { code: "Enter the 6-digit code." });
  try {
    await getAuth().api.verifyTOTP({ body: { code, trustDevice: false }, headers: await headers() });
  } catch (error) {
    if (!isAPIError(error)) throw error;
    await logActivity("admin.mfa_failed", `${admin.name} entered a wrong code to confirm their identity`, { actorId: admin.id, entityType: "admin", entityId: admin.id });
    const locked = /locked/i.test(String(error.body?.message ?? error.message));
    throw new AdminError(locked ? "Too many incorrect codes. Two-factor is locked for 15 minutes." : "That code isn't right.", { code: "Incorrect code." });
  }
  await markSecondFactorVerified({ sessionId: admin.sessionId }, admin.id);
  await logActivity("admin.reauthenticated", `${admin.name} confirmed their identity with an authenticator code`, { actorId: admin.id, entityType: "admin", entityId: admin.id });
  refresh();
  return { ok: true, message: "Confirmed. You can make security changes for the next 15 minutes." };
});

export const changePassword = permittedAction("own_account", async (admin, data: FormData) => {
  const since = new Date();
  await throttle(admin.id, "password");
  const current = str(data, "currentPassword");
  const next = str(data, "newPassword");
  const errors: Record<string, string> = {};
  if (!current) errors.currentPassword = "Enter your current password.";
  const strength = validatePasswordStrength(next);
  if (strength) errors.newPassword = strength;
  if (next !== str(data, "confirmPassword")) errors.confirmPassword = "The passwords don't match.";
  if (current && next && current === next) errors.newPassword = "Choose a password you haven't used here.";
  if (Object.keys(errors).length) throw new AdminError("Please correct the highlighted fields.", errors);
  try {
    // Signs out every other device and rotates this session.
    await getAuth().api.changePassword({ body: { currentPassword: current, newPassword: next, revokeOtherSessions: true }, headers: await headers() });
  } catch (error) {
    if (isAPIError(error)) throw new AdminError("Your current password is incorrect.", { currentPassword: "Incorrect password." });
    throw error;
  }
  await logActivity("account.password_changed", `${admin.name} changed their password`, { actorId: admin.id, entityType: "admin", entityId: admin.id });
  const devices = await revokeDevices(admin, admin, "password_changed", since);
  refresh();
  return {
    ok: true,
    message: `Password changed. You've been signed out on other devices${devices ? " and your trusted devices will ask for a code again" : ""}.`,
  };
});

/** New backup codes (the old ones stop working). Returned once; stored only encrypted. */
export async function regenerateBackupCodes(password: string): Promise<{ ok: boolean; codes?: string[]; message?: string }> {
  const admin = await requireAdmin();
  if (!(await rateLimit(`security:backup-codes:${admin.id}`, 10, 15 * 60)).allowed) return { ok: false, message: "Too many attempts. Please wait 15 minutes." };
  try {
    const res = (await getAuth().api.generateBackupCodes({ body: { password: String(password).slice(0, 200) }, headers: await headers() })) as { backupCodes?: string[] };
    await logActivity("admin.backup_codes_regenerated", `${admin.name} generated new backup codes`, { actorId: admin.id, entityType: "admin", entityId: admin.id });
    return { ok: true, codes: res.backupCodes ?? [] };
  } catch (error) {
    if (isAPIError(error)) return { ok: false, message: "That password isn't correct." };
    logger.error("Backup code regeneration failed", { error });
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

/** Replace the authenticator: turn two-factor off, then enrolment is required again immediately. */
export const replaceAuthenticator = permittedAction("own_account", async (admin, data: FormData) => {
  await throttle(admin.id, "replace-mfa");
  const since = new Date();
  try {
    await getAuth().api.disableTwoFactor({ body: { password: str(data, "password") }, headers: await headers() });
  } catch (error) {
    if (isAPIError(error)) throw new AdminError("That password isn't correct.", { password: "Incorrect password." });
    throw error;
  }
  await logActivity("admin.mfa_reset", `${admin.name} replaced their authenticator app`, { actorId: admin.id, entityType: "admin", entityId: admin.id });
  await revokeDevices(admin, admin, "two_factor_changed", since);
  redirect("/admin/setup-mfa");
});

export const revokeMySession = permittedAction("own_account", async (admin, sessionId: string) => {
  if (sessionId === admin.sessionId) throw new AdminError("Use Sign out to end this session.");
  const res = await prisma.adminSession.deleteMany({ where: { id: sessionId, userId: admin.id } });
  if (!res.count) throw new AdminError("That session has already ended.");
  await logActivity("admin.sessions_revoked", `${admin.name} signed out one of their other sessions`, { actorId: admin.id, entityType: "admin", entityId: admin.id });
  refresh();
  return { ok: true, message: "Session signed out." };
});

export const revokeMyOtherSessions = permittedAction("own_account", async (admin) => {
  const res = await prisma.adminSession.deleteMany({ where: { userId: admin.id, id: { not: admin.sessionId } } });
  await logActivity("admin.sessions_revoked", `${admin.name} signed out their other sessions (${res.count})`, { actorId: admin.id, entityType: "admin", entityId: admin.id });
  refresh();
  return { ok: true, message: res.count ? `Signed out ${res.count} other session${res.count === 1 ? "" : "s"}.` : "No other sessions were active." };
});

/* Your trusted devices ----------------------------------------------------------- */

export const revokeMyTrustedDevice = permittedAction("own_account", async (admin, deviceId: string) => {
  const device = await revokeTrustedDevice(admin.id, String(deviceId), admin.id);
  if (!device) throw new AdminError("That device is no longer trusted.");
  await logActivity("admin.trusted_device_revoked", `${admin.name} revoked trust for ${device.label}`, { actorId: admin.id, entityType: "trusted_device", entityId: device.id });
  refresh();
  return { ok: true, message: `${device.label} will ask for a code at the next sign-in.` };
});

export const revokeAllMyTrustedDevices = permittedAction("own_account", async (admin) => {
  const count = await revokeDevices(admin, admin, "revoked_all");
  refresh();
  return { ok: true, message: count ? `Revoked ${count} trusted device${count === 1 ? "" : "s"}. Every sign-in will ask for a code.` : "You had no trusted devices." };
});

export const renameMyTrustedDevice = permittedAction("own_account", async (admin, deviceId: string, data: FormData) => {
  const label = z.string().trim().min(1, "Enter a name.").max(60, "Keep it under 60 characters.").parse(str(data, "label"));
  if (!(await renameTrustedDevice(admin.id, String(deviceId), label))) throw new AdminError("That device is no longer trusted.");
  await logActivity("admin.trusted_device_renamed", `${admin.name} renamed a trusted device to “${label}”`, { actorId: admin.id, entityType: "trusted_device", entityId: String(deviceId) });
  refresh();
  return { ok: true, message: "Renamed." };
});

/* Admin users (owner only) --------------------------------------------------------- */

const roleSchema = z.enum(["OWNER", "ADMIN", "EDITOR"], { message: "Choose a role." });

async function target(userId: string) {
  const user = await prisma.adminUser.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true, active: true } });
  if (!user) throw new AdminError("That admin no longer exists.");
  return user;
}

async function assertNotLastOwner(user: { id: string; role: string; active: boolean }) {
  if (user.role !== "OWNER" || !user.active) return;
  const owners = await prisma.adminUser.count({ where: { role: "OWNER", active: true } });
  if (owners <= 1) throw new AdminError("There must always be at least one active owner.");
}

export const createAdminUser = freshOwnerAction(async (admin, data: FormData) => {
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Enter a name.").max(120),
      email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address.")),
      role: roleSchema,
    })
    .parse({ name: fd.str(data, "name"), email: fd.str(data, "email"), role: fd.str(data, "role") || "ADMIN" });
  const password = str(data, "password");
  const strength = validatePasswordStrength(password);
  if (strength) throw new AdminError("Please correct the highlighted fields.", { password: strength });
  if (await prisma.adminUser.findUnique({ where: { email: parsed.email }, select: { id: true } })) {
    throw new AdminError("Please correct the highlighted fields.", { email: "An admin with this email already exists." });
  }
  const user = await createPasswordAdmin(prisma, parsed, password);
  await logActivity("admin.created", `${admin.name} added ${parsed.name} (${parsed.email}) as ${parsed.role.toLowerCase()}`, { actorId: admin.id, entityType: "admin", entityId: user.id });
  refresh();
  return { ok: true, message: `${parsed.name} can now sign in. Share the initial password privately; they'll set up two-factor at first sign-in.` };
});

export const setAdminRole = freshOwnerAction(async (admin, userId: string, role: string) => {
  const next = roleSchema.parse(role);
  if (userId === admin.id) throw new AdminError("You can't change your own role.");
  const user = await target(userId);
  if (user.role === next) return { ok: true, message: "No change." };
  if (next !== "OWNER") await assertNotLastOwner(user);
  await prisma.adminUser.update({ where: { id: userId }, data: { role: next } });
  await logActivity("admin.role_changed", `${admin.name} changed ${user.name}'s role from ${user.role.toLowerCase()} to ${next.toLowerCase()}`, {
    actorId: admin.id,
    entityType: "admin",
    entityId: userId,
  });
  refresh();
  return { ok: true, message: `${user.name} is now ${next === "OWNER" ? "an owner" : next === "ADMIN" ? "an admin" : "an editor"}.` };
});

export const setAdminActive = freshOwnerAction(async (admin, userId: string, active: boolean) => {
  if (userId === admin.id && !active) throw new AdminError("You can't deactivate your own account.");
  const user = await target(userId);
  if (!active) await assertNotLastOwner(user);
  const since = new Date();
  await prisma.$transaction([
    prisma.adminUser.update({ where: { id: userId }, data: { active } }),
    ...(active ? [] : [prisma.adminSession.deleteMany({ where: { userId } })]),
  ]);
  await logActivity("admin.updated", `${admin.name} ${active ? "reactivated" : "deactivated"} ${user.name}`, { actorId: admin.id, entityType: "admin", entityId: userId });
  if (!active) await revokeDevices(admin, user, "account_disabled", since);
  refresh();
  return { ok: true, message: active ? `${user.name} reactivated.` : `${user.name} deactivated and signed out everywhere.` };
});

export const revokeAdminSessions = freshOwnerAction(async (admin, userId: string) => {
  const user = await target(userId);
  const res = await prisma.adminSession.deleteMany({ where: { userId, ...(userId === admin.id ? { id: { not: admin.sessionId } } : {}) } });
  await revokeDevices(admin, user, "signed_out_everywhere");
  await logActivity("admin.sessions_revoked", `${admin.name} signed ${user.name} out everywhere (${res.count} session${res.count === 1 ? "" : "s"})`, {
    actorId: admin.id,
    entityType: "admin",
    entityId: userId,
  });
  refresh();
  return { ok: true, message: `${user.name} was signed out of ${res.count} session${res.count === 1 ? "" : "s"}.` };
});

export const resetAdminTwoFactor = freshOwnerAction(async (admin, userId: string) => {
  if (userId === admin.id) throw new AdminError("To replace your own authenticator, use “Replace authenticator” under Your account.");
  const user = await target(userId);
  const since = new Date();
  await prisma.$transaction([
    prisma.adminTwoFactor.deleteMany({ where: { userId } }),
    prisma.adminUser.update({ where: { id: userId }, data: { twoFactorEnabled: false } }),
    prisma.adminSession.deleteMany({ where: { userId } }),
  ]);
  await logActivity("admin.mfa_reset", `${admin.name} reset two-factor for ${user.name}`, { actorId: admin.id, entityType: "admin", entityId: userId });
  await revokeDevices(admin, user, "two_factor_changed", since);
  refresh();
  return { ok: true, message: `${user.name} was signed out and will set up a new authenticator at next sign-in.` };
});

export const resetAdminPassword = freshOwnerAction(async (admin, userId: string, data: FormData) => {
  if (userId === admin.id) throw new AdminError("Change your own password under Your account.");
  const user = await target(userId);
  const password = str(data, "password");
  const strength = validatePasswordStrength(password);
  if (strength) throw new AdminError("Please correct the highlighted fields.", { password: strength });
  const since = new Date();
  await setAdminPassword(prisma, userId, password);
  await prisma.adminSession.deleteMany({ where: { userId } });
  await revokeDevices(admin, user, "password_reset", since);
  await logActivity("admin.password_reset", `${admin.name} reset ${user.name}'s password`, { actorId: admin.id, entityType: "admin", entityId: userId });
  refresh();
  return { ok: true, message: `${user.name}'s password was reset and they were signed out. Share the new password privately.` };
});
