"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAPIError } from "better-auth/api";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { AdminError, adminAction, fd, ownerAction } from "@/lib/admin/action";
import { getAuth } from "@/lib/auth/auth";
import { requireAdmin } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { validatePasswordStrength } from "@/lib/auth/password";
import { createPasswordAdmin, setAdminPassword } from "@/lib/auth/accounts";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Security & admin users. Your own account: password, two-factor, sessions.
 * Owner only (ownerAction): create admins, change roles, deactivate, reset
 * passwords/two-factor and sign accounts out everywhere. Every change is
 * written to the audit log; secrets never are.
 */

const refresh = () => revalidatePath("/admin/security");
const str = (data: FormData, key: string) => (typeof data.get(key) === "string" ? String(data.get(key)) : "");

async function throttle(adminId: string, what: string) {
  if (!(await rateLimit(`security:${what}:${adminId}`, 10, 15 * 60)).allowed) throw new AdminError("Too many attempts. Please wait 15 minutes and try again.");
}

/* Your account ---------------------------------------------------------------- */

export const changePassword = adminAction(async (admin, data: FormData) => {
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
  refresh();
  return { ok: true, message: "Password changed. You've been signed out on other devices." };
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
export const replaceAuthenticator = adminAction(async (admin, data: FormData) => {
  await throttle(admin.id, "replace-mfa");
  try {
    await getAuth().api.disableTwoFactor({ body: { password: str(data, "password") }, headers: await headers() });
  } catch (error) {
    if (isAPIError(error)) throw new AdminError("That password isn't correct.", { password: "Incorrect password." });
    throw error;
  }
  await logActivity("admin.mfa_reset", `${admin.name} replaced their authenticator app`, { actorId: admin.id, entityType: "admin", entityId: admin.id });
  redirect("/admin/setup-mfa");
});

export const revokeMySession = adminAction(async (admin, sessionId: string) => {
  if (sessionId === admin.sessionId) throw new AdminError("Use Sign out to end this session.");
  const res = await prisma.adminSession.deleteMany({ where: { id: sessionId, userId: admin.id } });
  if (!res.count) throw new AdminError("That session has already ended.");
  await logActivity("admin.sessions_revoked", `${admin.name} signed out one of their other sessions`, { actorId: admin.id, entityType: "admin", entityId: admin.id });
  refresh();
  return { ok: true, message: "Session signed out." };
});

export const revokeMyOtherSessions = adminAction(async (admin) => {
  const res = await prisma.adminSession.deleteMany({ where: { userId: admin.id, id: { not: admin.sessionId } } });
  await logActivity("admin.sessions_revoked", `${admin.name} signed out their other sessions (${res.count})`, { actorId: admin.id, entityType: "admin", entityId: admin.id });
  refresh();
  return { ok: true, message: res.count ? `Signed out ${res.count} other session${res.count === 1 ? "" : "s"}.` : "No other sessions were active." };
});

/* Admin users (owner only) --------------------------------------------------------- */

const roleSchema = z.enum(["OWNER", "ADMIN"], { message: "Choose a role." });

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

export const createAdminUser = ownerAction(async (admin, data: FormData) => {
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

export const setAdminRole = ownerAction(async (admin, userId: string, role: string) => {
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
  return { ok: true, message: `${user.name} is now ${next === "OWNER" ? "an owner" : "an admin"}.` };
});

export const setAdminActive = ownerAction(async (admin, userId: string, active: boolean) => {
  if (userId === admin.id && !active) throw new AdminError("You can't deactivate your own account.");
  const user = await target(userId);
  if (!active) await assertNotLastOwner(user);
  await prisma.$transaction([
    prisma.adminUser.update({ where: { id: userId }, data: { active } }),
    ...(active ? [] : [prisma.adminSession.deleteMany({ where: { userId } })]),
  ]);
  await logActivity("admin.updated", `${admin.name} ${active ? "reactivated" : "deactivated"} ${user.name}`, { actorId: admin.id, entityType: "admin", entityId: userId });
  refresh();
  return { ok: true, message: active ? `${user.name} reactivated.` : `${user.name} deactivated and signed out everywhere.` };
});

export const revokeAdminSessions = ownerAction(async (admin, userId: string) => {
  const user = await target(userId);
  const res = await prisma.adminSession.deleteMany({ where: { userId, ...(userId === admin.id ? { id: { not: admin.sessionId } } : {}) } });
  await logActivity("admin.sessions_revoked", `${admin.name} signed ${user.name} out everywhere (${res.count} session${res.count === 1 ? "" : "s"})`, {
    actorId: admin.id,
    entityType: "admin",
    entityId: userId,
  });
  refresh();
  return { ok: true, message: `${user.name} was signed out of ${res.count} session${res.count === 1 ? "" : "s"}.` };
});

export const resetAdminTwoFactor = ownerAction(async (admin, userId: string) => {
  if (userId === admin.id) throw new AdminError("To replace your own authenticator, use “Replace authenticator” under Your account.");
  const user = await target(userId);
  await prisma.$transaction([
    prisma.adminTwoFactor.deleteMany({ where: { userId } }),
    prisma.adminUser.update({ where: { id: userId }, data: { twoFactorEnabled: false } }),
    prisma.adminSession.deleteMany({ where: { userId } }),
  ]);
  await logActivity("admin.mfa_reset", `${admin.name} reset two-factor for ${user.name}`, { actorId: admin.id, entityType: "admin", entityId: userId });
  refresh();
  return { ok: true, message: `${user.name} was signed out and will set up a new authenticator at next sign-in.` };
});

export const resetAdminPassword = ownerAction(async (admin, userId: string, data: FormData) => {
  if (userId === admin.id) throw new AdminError("Change your own password under Your account.");
  const user = await target(userId);
  const password = str(data, "password");
  const strength = validatePasswordStrength(password);
  if (strength) throw new AdminError("Please correct the highlighted fields.", { password: strength });
  await setAdminPassword(prisma, userId, password);
  await prisma.adminSession.deleteMany({ where: { userId } });
  await logActivity("admin.password_reset", `${admin.name} reset ${user.name}'s password`, { actorId: admin.id, entityType: "admin", entityId: userId });
  refresh();
  return { ok: true, message: `${user.name}'s password was reset and they were signed out. Share the new password privately.` };
});
