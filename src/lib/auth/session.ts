import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  SESSION_COOKIE,
  SESSION_REFRESH_MS,
  SESSION_TTL_MS,
  generateSessionToken,
  hashSessionToken,
} from "./tokens";

export type CurrentAdmin = {
  id: string;
  email: string;
  name: string;
  role: "OWNER" | "ADMIN" | "EDITOR";
  sessionId: string;
};

const cookieOptions = (expires: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  expires,
});

export async function createAdminSession(userId: string) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const h = await headers();
  await prisma.adminSession.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt,
      ipAddress: clientIpFromHeaders(h),
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    },
  });
  await prisma.adminUser.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

/**
 * Validates the session cookie against the database. Memoized per request.
 * Returns null when not signed in, expired, or the user was deactivated.
 */
export const getCurrentAdmin = cache(async (): Promise<CurrentAdmin | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  try {
    const session = await prisma.adminSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || !session.user.active) return null;

    // Sliding expiration, written at most once a day.
    if (Date.now() - session.lastSeenAt.getTime() > SESSION_REFRESH_MS) {
      await prisma.adminSession
        .update({
          where: { id: session.id },
          data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
        })
        .catch(() => undefined);
    }
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      sessionId: session.id,
    };
  } catch (error) {
    logger.error("Session lookup failed", { error });
    return null;
  }
});

/** Use in every admin page, layout, server action and API route. */
export async function requireAdmin(): Promise<CurrentAdmin> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.adminSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } }).catch(() => undefined);
  }
  jar.delete(SESSION_COOKIE);
}

export function clientIpFromHeaders(h: Headers): string {
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim().slice(0, 64);
  return (h.get("x-real-ip") ?? "unknown").slice(0, 64);
}

export async function getClientIp(): Promise<string> {
  return clientIpFromHeaders(await headers());
}
