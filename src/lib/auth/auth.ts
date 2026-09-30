import "server-only";
import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins/two-factor";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getSiteOrigin } from "@/lib/site-url";
import { trustedIpHeaders } from "./client-ip";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password";

/**
 * Admin authentication, built on Better Auth (a maintained library) rather
 * than hand-rolled session or password code.
 *
 * - Passwords: scrypt. Legacy bcrypt hashes still verify and are upgraded on
 *   the next sign-in (see login actions).
 * - Sessions: database-backed and revocable. The cookie holds the session
 *   token plus an HMAC signature (BETTER_AUTH_SECRET); HttpOnly, SameSite=Lax,
 *   Secure (and "__Secure-" prefixed) in production. A new session is created
 *   on every sign-in (no fixation). Lifetime is absolute (never extended);
 *   the idle timeout is enforced in ./session.ts.
 * - Two-factor: TOTP authenticator apps with one-time backup codes. Secrets
 *   and codes are encrypted at rest; failed codes lock the account after 5
 *   attempts for 15 minutes. Enrolment is mandatory (./session.ts).
 * - No public sign-up. The HTTP handler is intentionally NOT mounted: every
 *   auth operation goes through our own server actions, which add throttling,
 *   generic errors and audit logging, so there is no /api/auth surface.
 */

export const SESSION_MAX_AGE_SECONDS = hours(Number(process.env.ADMIN_SESSION_MAX_HOURS) || 24 * 7);
export const SESSION_IDLE_SECONDS = hours(Number(process.env.ADMIN_SESSION_IDLE_HOURS) || 4);
export const TWO_FACTOR_ISSUER = "Wild Mountain Woodworks";

function hours(n: number) {
  return Math.round(n * 60 * 60);
}

export class AuthConfigError extends Error {}

const DEV_SECRET = "wild-mountain-development-only-secret-change-me-0123456789";

function resolveSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new AuthConfigError("BETTER_AUTH_SECRET is not set (or shorter than 32 characters). Admin sign-in is disabled until it is.");
  }
  return DEV_SECRET;
}

/** The admin origin (ADMIN_URL when the admin has its own subdomain), and every origin allowed to call auth. */
export function adminOrigin() {
  return (process.env.ADMIN_URL || getSiteOrigin()).replace(/\/$/, "");
}

function trustedOrigins() {
  const origins = new Set([adminOrigin(), getSiteOrigin()]);
  if (process.env.NODE_ENV !== "production") {
    for (const port of [3000, 3100]) origins.add(`http://localhost:${port}`);
  }
  return [...origins];
}

function createAuth() {
  return betterAuth({
    appName: TWO_FACTOR_ISSUER,
    secret: resolveSecret(),
    baseURL: adminOrigin(),
    basePath: "/api/auth",
    trustedOrigins: trustedOrigins(),
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    user: {
      modelName: "adminUser",
      additionalFields: {
        role: { type: "string", input: false },
        active: { type: "boolean", input: false },
      },
    },
    session: {
      modelName: "adminSession",
      expiresIn: SESSION_MAX_AGE_SECONDS,
      // Absolute lifetime: never slide the expiry. Idle timeout lives in ./session.ts.
      disableSessionRefresh: true,
      cookieCache: { enabled: false }, // always check the database, so revocation is immediate
      freshAge: 60 * 15,
    },
    account: { modelName: "adminAccount" },
    verification: { modelName: "adminVerification" },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: hashPassword,
        verify: async ({ hash, password }) => (hash.startsWith("$2") ? bcrypt.compare(password, hash) : verifyPassword({ hash, password })),
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 15 * 60, max: 10 },
        "/two-factor/*": { window: 5 * 60, max: 10 },
      },
      // Shared Postgres limiter: limits hold across instances and restarts.
      customStorage: {
        consume: async (key, rule) => {
          const r = await rateLimit(`auth:${key}`, rule.max, rule.window);
          return { allowed: r.allowed, retryAfter: r.allowed ? null : r.retryAfterSeconds };
        },
      },
    },
    advanced: {
      cookiePrefix: "wm_admin",
      useSecureCookies: process.env.NODE_ENV === "production",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: trustedIpHeaders() },
    },
    databaseHooks: {
      session: {
        create: {
          // Deactivated admins can never obtain a session (default deny).
          before: async (session) => {
            const user = await prisma.adminUser.findUnique({ where: { id: session.userId }, select: { active: true } });
            return user?.active ? undefined : false;
          },
        },
      },
    },
    plugins: [
      twoFactor({
        issuer: TWO_FACTOR_ISSUER,
        twoFactorTable: "adminTwoFactor",
        twoFactorCookieMaxAge: 60 * 10,
        backupCodeOptions: { amount: 10, length: 10 },
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 15 * 60 },
      }),
      nextCookies(), // must be last: lets server actions set auth cookies
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | null = null;

/**
 * Created on first use so the public site (and the build) never needs the
 * auth secret. Throws AuthConfigError in production without BETTER_AUTH_SECRET.
 */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}

export const SESSION_COOKIE_PREFIX = "wm_admin";
