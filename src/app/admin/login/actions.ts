"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isAPIError } from "better-auth/api";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { AuthConfigError, getAuth } from "@/lib/auth/auth";
import { getClientIp, getSessionState } from "@/lib/auth/session";
import { hashAdminPassword } from "@/lib/auth/password";
import { peekRateLimit, rateLimit, resetRateLimit } from "@/lib/rate-limit";

export type LoginState = { error?: string; email?: string } | undefined;
export type VerifyState = { error?: string } | undefined;

/** One message for every credential failure, so responses never reveal whether an account exists. */
const GENERIC_FAILURE = "That email and password combination isn't correct.";
const LOCKED = "Too many sign-in attempts. Please wait 15 minutes and try again.";

/** Progressive throttling: after 3 failures each attempt is slowed; after 10 the address is locked for the window. */
const FAIL_WINDOW = 15 * 60;
const LOCK_AFTER = 10;

const schema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).max(200),
  next: z.string().max(500).optional(),
});

function safeNext(next: string | undefined | null) {
  if (!next || !next.startsWith("/admin") || next.startsWith("//") || next.includes("\\")) return "/admin";
  return next;
}

type SignInResult = { twoFactorRedirect?: boolean; user?: { id: string; name: string } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function configError(error: unknown) {
  if (error instanceof AuthConfigError) {
    logger.error(error.message);
    return "Sign-in is temporarily unavailable. The site owner needs to finish the security configuration.";
  }
  return null;
}

/** Step 1: email + password. */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter your email and password.", email: String(formData.get("email") ?? "").slice(0, 254) };
  const { email, password, next } = parsed.data;

  const ip = await getClientIp();
  const failKey = `login:fail:${email}`;
  const [byIp, byEmail, failures] = await Promise.all([
    rateLimit(`login:ip:${ip}`, 30, FAIL_WINDOW),
    rateLimit(`login:email:${email}`, 20, FAIL_WINDOW),
    peekRateLimit(failKey),
  ]);
  if (!byIp.allowed || !byEmail.allowed || failures >= LOCK_AFTER) {
    if (failures === LOCK_AFTER) await logActivity("admin.login_locked", `Sign-in locked for ${email} after repeated failures`, { entityType: "admin" });
    return { error: LOCKED, email };
  }
  if (failures >= 3) await sleep(Math.min(8000, 500 * 2 ** (failures - 3)));

  let result: SignInResult | null = null;
  try {
    result = (await getAuth().api.signInEmail({ body: { email, password, rememberMe: true }, headers: await headers() })) as unknown as SignInResult;
  } catch (error) {
    const cfg = configError(error);
    if (cfg) return { error: cfg, email };
    if (!isAPIError(error)) logger.error("Sign-in failed unexpectedly", { error });
    await rateLimit(failKey, LOCK_AFTER + 1, FAIL_WINDOW);
    await logActivity("admin.login_failed", `Failed sign-in for ${email}`, { entityType: "admin" });
    return { error: GENERIC_FAILURE, email };
  }
  await resetRateLimit(failKey);

  // The password was correct: upgrade a legacy bcrypt hash to scrypt.
  const user = await prisma.adminUser.findUnique({ where: { email }, select: { id: true, name: true } });
  if (user) {
    const account = await prisma.adminAccount.findFirst({ where: { userId: user.id, providerId: "credential" }, select: { id: true, password: true } });
    if (account?.password?.startsWith("$2")) {
      await prisma.adminAccount.update({ where: { id: account.id }, data: { password: await hashAdminPassword(password) } }).catch(() => undefined);
    }
  }

  if (result?.twoFactorRedirect) {
    redirect(`/admin/login/verify?next=${encodeURIComponent(safeNext(next))}`);
  }
  // No second factor yet: the session only grants access to enrolment.
  if (user) {
    await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await logActivity("admin.login", `${user.name} signed in (two-factor enrolment required)`, { actorId: user.id, entityType: "admin", entityId: user.id });
  }
  redirect("/admin/setup-mfa");
}

const codeSchema = z
  .object({
    code: z.string().trim().max(40),
    method: z.enum(["totp", "backup"]),
    next: z.string().max(500).optional(),
  })
  // Authenticator codes: digits only ("123 456" → "123456"). Backup codes keep their dash.
  .transform((v) => ({ ...v, code: v.method === "totp" ? v.code.replace(/\D/g, "") : v.code.replace(/\s/g, "") }))
  .refine((v) => (v.method === "totp" ? /^\d{6}$/.test(v.code) : v.code.length >= 6));

/** Step 2: the authenticator-app code (or a one-time backup code). */
export async function verifyTwoFactorAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const parsed = codeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter the code from your authenticator app." };
  const { code, method, next } = parsed.data;

  const ip = await getClientIp();
  if (!(await rateLimit(`2fa:ip:${ip}`, 20, 15 * 60)).allowed) return { error: "Too many attempts. Please wait 15 minutes and try again." };

  const h = await headers();
  let userId: string | null = null;
  try {
    const res = (method === "totp"
      ? await getAuth().api.verifyTOTP({ body: { code, trustDevice: false }, headers: h })
      : await getAuth().api.verifyBackupCode({ body: { code, trustDevice: false }, headers: h })) as { user?: { id: string } };
    userId = res.user?.id ?? null;
  } catch (error) {
    const cfg = configError(error);
    if (cfg) return { error: cfg };
    const message = isAPIError(error) ? String(error.body?.message ?? error.message) : "";
    if (/cookie/i.test(message)) return { error: "Your sign-in timed out. Please start again." };
    await logActivity("admin.mfa_failed", `Failed two-factor code (${method === "totp" ? "authenticator" : "backup code"})`, { entityType: "admin" });
    if (/locked/i.test(message)) return { error: "Too many incorrect codes. This account is locked for 15 minutes." };
    return { error: method === "totp" ? "That code isn't right. Check your authenticator app and try again." : "That backup code isn't valid." };
  }

  if (userId) {
    const user = await prisma.adminUser.update({ where: { id: userId }, data: { lastLoginAt: new Date() }, select: { name: true } });
    await logActivity("admin.login", `${user.name} signed in`, { actorId: userId, entityType: "admin", entityId: userId });
    if (method === "backup") {
      await logActivity("admin.backup_code_used", `${user.name} signed in with a backup code`, { actorId: userId, entityType: "admin", entityId: userId });
    }
  }
  redirect(safeNext(next));
}

/** Sign out: the server-side session row is deleted, not just the cookie. */
export async function logoutAction() {
  const state = await getSessionState();
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch (error) {
    logger.warn("Sign-out call failed; removing the session directly", { error });
  }
  if (state) {
    await prisma.adminSession.deleteMany({ where: { id: state.admin.sessionId } });
    await logActivity("admin.logout", `${state.admin.name} signed out`, { actorId: state.admin.id, entityType: "admin", entityId: state.admin.id });
  }
  redirect("/admin/login");
}
