import { randomBytes } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * DEVELOPMENT/TEST ONLY: create a Better Auth admin session directly in the
 * database and return the signed cookie that represents it (the same format
 * Better Auth sets after a real sign-in). Used by the QA script and tests;
 * refuses to run in production.
 */
export async function mintAdminSession(prisma: PrismaClient, userId: string, opts: { ageMs?: number; idleMs?: number } = {}) {
  if (process.env.NODE_ENV === "production") throw new Error("mintAdminSession is not available in production.");
  const secret = process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 32 ? process.env.BETTER_AUTH_SECRET : "wild-mountain-development-only-secret-change-me-0123456789";
  const token = randomBytes(24).toString("base64url");
  const now = Date.now();
  const session = await prisma.adminSession.create({
    data: {
      token,
      userId,
      expiresAt: new Date(now + 7 * 24 * 3600 * 1000),
      createdAt: new Date(now - (opts.ageMs ?? 0)),
      updatedAt: new Date(now - (opts.idleMs ?? 0)),
    },
  });
  const value = encodeURIComponent(`${token}.${await makeSignature(token, secret)}`);
  return { session, cookieName: "wm_admin.session_token", cookieValue: value, cookie: `wm_admin.session_token=${value}` };
}
