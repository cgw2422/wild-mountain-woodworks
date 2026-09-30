import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { createOTP } = await import("@better-auth/utils/otp");
const { base32 } = await import("@better-auth/utils/base32");
const bcrypt = (await import("bcryptjs")).default;
const { prisma } = await import("@/lib/db");
const session = await import("@/lib/auth/session");
const { getAuth } = await import("@/lib/auth/auth");
const { createPasswordAdmin } = await import("@/lib/auth/accounts");
const login = await import("@/app/admin/login/actions");
const enroll = await import("@/app/admin/setup-mfa/actions");
const security = await import("@/app/admin/(panel)/security/actions");
const products = await import("@/app/admin/(panel)/products/actions");
const { rateLimit } = await import("@/lib/rate-limit");
const { hasTestDb, resetDb } = await import("../support/db");
const { checkPublicSubmission } = await import("@/lib/services/abuse");
const req = await import("../support/next-request");

const PASSWORD = "a-good-passphrase-1";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Run a server action that ends in redirect(); return the destination. */
async function redirectOf(p: Promise<unknown>) {
  try {
    const r = await p;
    return { returned: r };
  } catch (e) {
    const m = /^REDIRECT (.*)$/.exec((e as Error).message);
    if (m) return { redirect: m[1]! };
    throw e;
  }
}

async function newAdmin(opts: { email?: string; role?: "OWNER" | "ADMIN"; password?: string; hash?: string } = {}) {
  const user = await createPasswordAdmin(prisma, { email: opts.email ?? "owner@example.com", name: "Owner", role: opts.role ?? "OWNER" }, opts.password ?? PASSWORD);
  if (opts.hash) await prisma.adminAccount.updateMany({ where: { userId: user.id }, data: { password: opts.hash } });
  return user;
}

/** Password sign-in + full authenticator enrolment; returns a TOTP generator for this admin. */
async function enrolled(email = "owner@example.com") {
  expect((await redirectOf(login.loginAction(undefined, form({ email, password: PASSWORD })))).redirect).toBe("/admin/setup-mfa");
  const start = await enroll.startEnrollment(PASSWORD);
  if (!start.ok) throw new Error(start.error);
  const otp = createOTP(new TextDecoder().decode(base32.decode(start.secret)));
  expect(await enroll.confirmEnrollment(await otp.totp())).toEqual({ ok: true });
  return { otp, backupCodes: start.backupCodes };
}

describe.skipIf(!hasTestDb)("admin authentication (Better Auth)", () => {
  beforeEach(async () => {
    await resetDb();
    req.resetRequest();
  });

  it("forces two-factor enrolment before anything else, then requires a code at every sign-in", async () => {
    await newAdmin();
    // Password alone: a session that only reaches the enrolment page.
    expect((await redirectOf(login.loginAction(undefined, form({ email: "owner@example.com", password: PASSWORD })))).redirect).toBe("/admin/setup-mfa");
    expect(await session.getCurrentAdmin()).toBeNull();
    await expect(session.requireAdmin()).rejects.toThrow(/REDIRECT \/admin\/setup-mfa/);
    await expect(products.duplicateProduct("anything")).rejects.toThrow(/REDIRECT \/admin\/setup-mfa/);

    // Enrolment needs the password and a valid code; backup codes are issued once.
    expect(await enroll.startEnrollment("wrong-password-123")).toMatchObject({ ok: false });
    const start = await enroll.startEnrollment(PASSWORD);
    if (!start.ok) throw new Error(start.error);
    expect(start.backupCodes).toHaveLength(10);
    expect(start.qr).toMatch(/^data:image\/png;base64,/);
    expect(await enroll.confirmEnrollment("000000")).toMatchObject({ ok: false });
    const otp = createOTP(new TextDecoder().decode(base32.decode(start.secret)));
    expect(await enroll.confirmEnrollment(await otp.totp())).toEqual({ ok: true });
    await expect(session.requireAdmin()).resolves.toMatchObject({ email: "owner@example.com", role: "OWNER" });

    // Secrets are encrypted at rest.
    const tf = await prisma.adminTwoFactor.findFirstOrThrow();
    expect(tf.secret).not.toContain(start.secret);
    expect(tf.backupCodes).not.toContain(start.backupCodes[0]!);

    // Sign out → the server-side session is gone.
    expect((await redirectOf(login.logoutAction())).redirect).toBe("/admin/login");
    expect(await prisma.adminSession.count()).toBe(0);
    expect(await session.getCurrentAdmin()).toBeNull();

    // Next sign-in: no session until the second factor is verified.
    expect((await redirectOf(login.loginAction(undefined, form({ email: "owner@example.com", password: PASSWORD, next: "/admin/quotes" })))).redirect).toBe(
      "/admin/login/verify?next=%2Fadmin%2Fquotes",
    );
    expect(await prisma.adminSession.count()).toBe(0);
    expect(await login.verifyTwoFactorAction(undefined, form({ code: "123456", method: "totp" }))).toMatchObject({ error: expect.stringMatching(/isn't right/) });
    expect((await redirectOf(login.verifyTwoFactorAction(undefined, form({ code: await otp.totp(), method: "totp", next: "/admin/quotes" })))).redirect).toBe("/admin/quotes");
    await expect(session.requireAdmin()).resolves.toMatchObject({ email: "owner@example.com" });

    const log = await prisma.activityLog.findMany({ where: { type: { in: ["admin.login", "admin.mfa_enabled", "admin.mfa_failed", "admin.logout"] } } });
    expect(log.map((l) => l.type)).toEqual(expect.arrayContaining(["admin.login", "admin.mfa_enabled", "admin.mfa_failed", "admin.logout"]));
    expect(log.every((l) => l.ipAddress === "203.0.113.9" && l.userAgent === "vitest")).toBe(true);
  });

  it("accepts each backup code once", async () => {
    await newAdmin();
    const { backupCodes } = await enrolled();
    await redirectOf(login.logoutAction());
    const signIn = () => redirectOf(login.loginAction(undefined, form({ email: "owner@example.com", password: PASSWORD })));
    await signIn();
    expect((await redirectOf(login.verifyTwoFactorAction(undefined, form({ code: backupCodes[0]!, method: "backup" })))).redirect).toBe("/admin");
    await redirectOf(login.logoutAction());
    await signIn();
    expect(await login.verifyTwoFactorAction(undefined, form({ code: backupCodes[0]!, method: "backup" }))).toMatchObject({ error: expect.stringMatching(/isn't valid/) });
    expect(await prisma.activityLog.count({ where: { type: "admin.backup_code_used" } })).toBe(1);
  });

  it("locks the second factor after repeated wrong codes", async () => {
    await newAdmin();
    const { otp } = await enrolled();
    await redirectOf(login.logoutAction());
    await redirectOf(login.loginAction(undefined, form({ email: "owner@example.com", password: PASSWORD })));
    for (let i = 0; i < 5; i++) await login.verifyTwoFactorAction(undefined, form({ code: "000000", method: "totp" }));
    const res = await redirectOf(login.verifyTwoFactorAction(undefined, form({ code: await otp.totp(), method: "totp" })));
    expect(res.returned).toMatchObject({ error: expect.stringMatching(/locked|timed out/) });
    expect(await prisma.adminSession.count()).toBe(0);
  });

  it("gives one generic error for wrong passwords and unknown emails, logs failures, and locks out repeated failures", async () => {
    await newAdmin();
    const wrong = await login.loginAction(undefined, form({ email: "owner@example.com", password: "not-the-password-1" }));
    const unknown = await login.loginAction(undefined, form({ email: "nobody@example.com", password: "not-the-password-1" }));
    expect(wrong?.error).toBe(unknown?.error);
    expect(wrong?.error).toMatch(/isn't correct/);
    const failed = await prisma.activityLog.findMany({ where: { type: "admin.login_failed" } });
    expect(failed).toHaveLength(2);
    expect(failed.every((f) => !f.message.includes("not-the-password"))).toBe(true); // never log passwords

    // Simulate ten failures in the window (the lockout threshold).
    await prisma.rateLimitBucket.upsert({
      where: { key: "login:fail:owner@example.com" },
      update: { count: 10 },
      create: { key: "login:fail:owner@example.com", count: 10, resetAt: new Date(Date.now() + 600_000) },
    });
    const locked = await login.loginAction(undefined, form({ email: "owner@example.com", password: PASSWORD }));
    expect(locked?.error).toMatch(/Too many sign-in attempts/);
    expect(await prisma.adminSession.count()).toBe(0);
  });

  it("keeps legacy bcrypt passwords working and upgrades them to scrypt", async () => {
    await newAdmin({ hash: await bcrypt.hash(PASSWORD, 4) });
    expect((await redirectOf(login.loginAction(undefined, form({ email: "owner@example.com", password: PASSWORD })))).redirect).toBe("/admin/setup-mfa");
    const account = await prisma.adminAccount.findFirstOrThrow();
    expect(account.password!.startsWith("$2")).toBe(false);
  });

  it("refuses deactivated accounts and has no public sign-up", async () => {
    const u = await newAdmin();
    await prisma.adminUser.update({ where: { id: u.id }, data: { active: false } });
    expect((await login.loginAction(undefined, form({ email: "owner@example.com", password: PASSWORD })))?.error).toMatch(/isn't correct/);
    expect(await prisma.adminSession.count()).toBe(0);
    await expect(getAuth().api.signUpEmail({ body: { email: "attacker@example.com", password: "a-good-passphrase-2", name: "X" } })).rejects.toThrow();
    expect(await prisma.adminUser.count({ where: { email: "attacker@example.com" } })).toBe(0);
  });

  it("rejects forged, idle, over-age and revoked sessions", async () => {
    const u = await req.createSignedInAdmin();
    await expect(session.requireAdmin()).resolves.toMatchObject({ id: u.id });

    req.jar.set("wm_admin.session_token", "forged.token");
    expect(await session.getCurrentAdmin()).toBeNull();

    req.jar.clear();
    const idle = await req.signInAs(u.id, { idleMs: 5 * 3600 * 1000 });
    expect(await session.getCurrentAdmin()).toBeNull();
    expect(await prisma.adminSession.count({ where: { id: idle.id } })).toBe(0); // revoked server-side

    req.jar.clear();
    await req.signInAs(u.id, { ageMs: 8 * 24 * 3600 * 1000 });
    expect(await session.getCurrentAdmin()).toBeNull();

    req.jar.clear();
    await req.signInAs(u.id);
    await prisma.adminSession.deleteMany({ where: { userId: u.id } }); // "sign out everywhere"
    expect(await session.getCurrentAdmin()).toBeNull();
  });

  it("changes the password (old one stops working, other sessions end)", async () => {
    const u = await req.createSignedInAdmin();
    const other = await prisma.adminSession.create({ data: { token: "other-device", userId: u.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const res = await security.changePassword(form({ currentPassword: PASSWORD, newPassword: "another-good-pass-2", confirmPassword: "another-good-pass-2" }));
    expect(res.ok).toBe(true);
    expect(await prisma.adminSession.count({ where: { id: other.id } })).toBe(0);
    expect((await security.changePassword(form({ currentPassword: "wrong-password-99", newPassword: "x-good-pass-3", confirmPassword: "x-good-pass-3" }))).ok).toBe(false);
  });

  it("rate limits repeated attempts with a fixed window", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await rateLimit("login:test", 3, 60)).allowed);
    expect(results).toEqual([true, true, true, false]);
    await prisma.rateLimitBucket.update({ where: { key: "login:test" }, data: { resetAt: new Date(Date.now() - 1) } });
    expect((await rateLimit("login:test", 3, 60)).allowed).toBe(true);
  });
});

describe.skipIf(!hasTestDb)("roles and admin management", () => {
  beforeEach(async () => {
    await resetDb();
    req.resetRequest();
  });

  it("stops ordinary admins from managing admins or elevating themselves", async () => {
    const owner = await req.createSignedInAdmin({ signIn: false });
    const admin = await req.createSignedInAdmin({ role: "ADMIN", email: "helper@example.com" });
    const tries = await Promise.all([
      security.createAdminUser(form({ name: "Eve", email: "eve@example.com", role: "OWNER", password: "a-good-passphrase-9" })),
      security.setAdminRole(admin.id, "OWNER"),
      security.setAdminRole(owner.id, "ADMIN"),
      security.setAdminActive(owner.id, false),
      security.resetAdminTwoFactor(owner.id),
      security.revokeAdminSessions(owner.id),
      security.resetAdminPassword(owner.id, form({ password: "a-good-passphrase-9" })),
    ]);
    expect(tries.every((r) => r.ok === false && /Only an owner/.test(r.message ?? ""))).toBe(true);
    expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe("ADMIN");
    expect(await prisma.adminUser.count()).toBe(2);
    // The audit log is owner-only too.
    await expect(session.requireOwner()).rejects.toThrow(/REDIRECT \/admin$/);
  });

  it("lets an owner manage admins, with last-owner and self protections", async () => {
    const owner = await req.createSignedInAdmin();
    expect((await security.createAdminUser(form({ name: "Sam", email: "sam@example.com", role: "ADMIN", password: "a-good-passphrase-7" }))).ok).toBe(true);
    const sam = await prisma.adminUser.findUniqueOrThrow({ where: { email: "sam@example.com" } });
    expect(sam).toMatchObject({ role: "ADMIN", twoFactorEnabled: false });

    expect((await security.setAdminRole(owner.id, "ADMIN")).message).toMatch(/your own role/);
    expect((await security.setAdminActive(owner.id, false)).message).toMatch(/your own account/);
    expect((await security.setAdminRole(sam.id, "OWNER")).ok).toBe(true);
    expect((await security.setAdminRole(sam.id, "ADMIN")).ok).toBe(true);

    await prisma.adminSession.create({ data: { token: "sam-device", userId: sam.id, expiresAt: new Date(Date.now() + 3600_000) } });
    await prisma.adminUser.update({ where: { id: sam.id }, data: { twoFactorEnabled: true } });
    expect((await security.resetAdminTwoFactor(sam.id)).ok).toBe(true);
    expect(await prisma.adminUser.findUniqueOrThrow({ where: { id: sam.id } })).toMatchObject({ twoFactorEnabled: false });
    expect(await prisma.adminSession.count({ where: { userId: sam.id } })).toBe(0);

    expect((await security.setAdminActive(sam.id, false)).ok).toBe(true);
    const types = (await prisma.activityLog.findMany({ select: { type: true } })).map((t) => t.type);
    expect(types).toEqual(expect.arrayContaining(["admin.created", "admin.role_changed", "admin.mfa_reset", "admin.updated"]));
  });
});

describe.skipIf(!hasTestDb)("admin APIs enforce authentication themselves", () => {
  beforeEach(async () => {
    await resetDb();
    req.resetRequest();
  });

  it("rejects unauthenticated and cross-origin requests", async () => {
    const media = await import("@/app/api/admin/media/route");
    const videos = await import("@/app/api/admin/products/[id]/videos/route");
    const unauth = await media.POST(new Request("http://localhost:3000/api/admin/media", { method: "POST", body: new FormData() }));
    expect(unauth!.status).toBe(401);
    const unauthVideo = await videos.POST(new Request("http://localhost:3000/api/admin/products/x/videos", { method: "POST", body: new FormData() }), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(unauthVideo!.status).toBe(401);
    const list = await media.GET(new Request("http://localhost:3000/api/admin/media"));
    expect(list!.status).toBe(401);

    await req.createSignedInAdmin();
    const crossSite = await media.POST(
      new Request("http://localhost:3000/api/admin/media", { method: "POST", headers: { origin: "https://evil.example", host: "localhost:3000" }, body: new FormData() }),
    );
    expect(crossSite!.status).toBe(403);
  });
});

describe.skipIf(!hasTestDb)("public form abuse protection", () => {
  beforeEach(resetDb);

  const longAgo = String(Date.now() - 60_000);

  it("silently drops honeypot submissions", async () => {
    expect(await checkPublicSubmission(form({ company_website: "http://spam", form_started_at: longAgo }), "t")).toBe("bot");
  });

  it("asks instant submissions to retry instead of dropping them", async () => {
    expect(await checkPublicSubmission(form({ form_started_at: String(Date.now()) }), "t")).toBe("too-fast");
    expect(await checkPublicSubmission(form({ form_started_at: longAgo }), "t")).toBe("ok");
  });

  it("rate limits per IP and form", async () => {
    const verdicts = [];
    for (let i = 0; i < 3; i++) verdicts.push(await checkPublicSubmission(form({ form_started_at: longAgo }), "contact", { perWindow: 2, windowSeconds: 60 }));
    expect(verdicts).toEqual(["ok", "ok", "limited"]);
    expect(await checkPublicSubmission(form({ form_started_at: longAgo }), "quote", { perWindow: 2, windowSeconds: 60 })).toBe("ok");
  });
});
