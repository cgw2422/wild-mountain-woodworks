import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AuthConfigError, SESSION_IDLE_SECONDS, SESSION_MAX_AGE_SECONDS, getAuth } from "./auth";
import { clientIpFromHeaders } from "./client-ip";
import { can, type Permission, type Role } from "./permissions";

export { clientIpFromHeaders } from "./client-ip";

export type AdminRole = Role;

export type CurrentAdmin = {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  sessionId: string;
};

type SessionState = { admin: CurrentAdmin; mfaEnrolled: boolean };

/** How often last-activity is written (keeps idle tracking cheap). */
const ACTIVITY_WRITE_MS = 60_000;

/**
 * Resolve the signed-in admin for this request, or null. Memoized per request.
 *
 * Default deny: any error, a missing/expired/revoked session, a deactivated
 * account, or a session past its idle or absolute limit → null. The user's
 * role and status are re-read from the database on every request, so a
 * demotion or deactivation takes effect immediately.
 */
export const getSessionState = cache(async (): Promise<SessionState | null> => {
  try {
    const h = await headers();
    const result = await getAuth().api.getSession({ headers: h });
    if (!result) return null;
    const { session } = result;
    const now = Date.now();

    const idleFor = now - new Date(session.updatedAt).getTime();
    const age = now - new Date(session.createdAt).getTime();
    if (idleFor > SESSION_IDLE_SECONDS * 1000 || age > SESSION_MAX_AGE_SECONDS * 1000) {
      await prisma.adminSession.deleteMany({ where: { id: session.id } });
      return null;
    }

    const user = await prisma.adminUser.findUnique({
      where: { id: session.userId },
      select: { id: true, email: true, name: true, role: true, active: true, twoFactorEnabled: true },
    });
    if (!user || !user.active) {
      await prisma.adminSession.deleteMany({ where: { userId: session.userId } });
      return null;
    }

    if (idleFor > ACTIVITY_WRITE_MS) {
      await prisma.adminSession
        .update({ where: { id: session.id }, data: { updatedAt: new Date(), ipAddress: clientIpFromHeaders(h) } })
        .catch(() => undefined);
    }

    return {
      admin: { id: user.id, email: user.email, name: user.name, role: user.role, sessionId: session.id },
      mfaEnrolled: user.twoFactorEnabled,
    };
  } catch (error) {
    if (error instanceof AuthConfigError) logger.error(error.message);
    else logger.error("Session lookup failed", { error });
    return null;
  }
});

/**
 * The fully authenticated staff user (OWNER, ADMIN or EDITOR; signed in AND
 * two-factor enrolled), or null. A session without two-factor enrolment
 * grants nothing but the enrolment page.
 */
export async function getCurrentAdmin(): Promise<CurrentAdmin | null> {
  const state = await getSessionState();
  return state?.mfaEnrolled ? state.admin : null;
}

/** Any signed-in, two-factor-enrolled staff user, including editors (the admin shell, own account). */
export async function requireStaff(): Promise<CurrentAdmin> {
  const state = await getSessionState();
  if (!state) redirect("/admin/login");
  if (!state.mfaEnrolled) redirect("/admin/setup-mfa");
  return state.admin;
}

/**
 * Staff with a specific permission (src/lib/auth/permissions.ts). Anyone
 * else is sent back to the dashboard — every admin page calls this (or
 * requireAdmin/requireOwner), because layouts don't re-run on navigation.
 */
export async function requirePermission(permission: Permission): Promise<CurrentAdmin> {
  const admin = await requireStaff();
  if (!can(admin.role, permission)) redirect("/admin?denied=1");
  return admin;
}

/**
 * OWNER or ADMIN — ordinary site management. Editors are refused. This is
 * the default for admin pages that haven't been opened to editors.
 */
export async function requireAdmin(): Promise<CurrentAdmin> {
  const admin = await requireStaff();
  if (admin.role !== "OWNER" && admin.role !== "ADMIN") redirect("/admin?denied=1");
  return admin;
}

/** Owner-only pages and actions. Non-owners get a redirect to the dashboard. */
export async function requireOwner(): Promise<CurrentAdmin> {
  const admin = await requireStaff();
  if (admin.role !== "OWNER") redirect("/admin?denied=1");
  return admin;
}

/** Signed in, two-factor enrolment possibly still pending (enrolment page only). */
export async function requireSignedIn(): Promise<SessionState> {
  const state = await getSessionState();
  if (!state) redirect("/admin/login");
  return state;
}

export async function getClientIp(): Promise<string> {
  return clientIpFromHeaders(await headers());
}

/**
 * Step-up for owner security changes: how long a proven second factor counts
 * as fresh. Sessions opened with an authenticator or backup code start fresh;
 * sessions opened on a trusted device (code skipped) do not, so the first
 * owner change asks for a code ("Confirm it's you" on the Security page).
 */
export const STEP_UP_WINDOW_SECONDS = 15 * 60;

/** When the second factor stops counting as fresh for this session, or null if it isn't fresh now. */
export async function secondFactorFreshUntil(admin: CurrentAdmin): Promise<Date | null> {
  const s = await prisma.adminSession.findUnique({ where: { id: admin.sessionId }, select: { userId: true, twoFactorVerifiedAt: true } });
  if (!s || s.userId !== admin.id || !s.twoFactorVerifiedAt) return null;
  const until = new Date(s.twoFactorVerifiedAt.getTime() + STEP_UP_WINDOW_SECONDS * 1000);
  return until.getTime() > Date.now() ? until : null;
}

export async function markSecondFactorVerified(where: { sessionId?: string; token?: string }, userId: string) {
  if (!where.sessionId && !where.token) return;
  await prisma.adminSession.updateMany({ where: { ...(where.sessionId ? { id: where.sessionId } : { token: where.token }), userId }, data: { twoFactorVerifiedAt: new Date() } });
}
