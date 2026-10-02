import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { createHash } = await import("node:crypto");
const { createOTP } = await import("@better-auth/utils/otp");
const { base32 } = await import("@better-auth/utils/base32");
const { prisma } = await import("@/lib/db");
const session = await import("@/lib/auth/session");
const { getAuth } = await import("@/lib/auth/auth");
const { createPasswordAdmin } = await import("@/lib/auth/accounts");
const trusted = await import("@/lib/auth/trusted-devices");
const login = await import("@/app/admin/login/actions");
const enroll = await import("@/app/admin/setup-mfa/actions");
const security = await import("@/app/admin/(panel)/security/actions");
const products = await import("@/app/admin/(panel)/products/actions");
const { hasTestDb, resetDb } = await import("../support/db");
const req = await import("../support/next-request");

const PASSWORD = "a-good-passphrase-1";
const COOKIE = "wm_admin.trusted_device";
const DAY = 24 * 60 * 60 * 1000;
const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function redirectOf(p: Promise<unknown>) {
  try {
    return { returned: await p };
  } catch (e) {
    const m = /^REDIRECT (.*)$/.exec((e as Error).message);
    if (m) return { redirect: m[1]! };
    throw e;
  }
}

const cookieToken = () => (req.jar.has(COOKIE) ? decodeURIComponent(req.jar.get(COOKIE)!) : null);
const signIn = (email: string, password = PASSWORD, next?: string) => redirectOf(login.loginAction(undefined, form({ email, password, ...(next ? { next } : {}) })));
const verify = (code: string, opts: { trust?: boolean; method?: "totp" | "backup" } = {}) =>
  redirectOf(login.verifyTwoFactorAction(undefined, form({ code, method: opts.method ?? "totp", ...(opts.trust ? { trust: "on" } : {}) })));
const signOut = () => redirectOf(login.logoutAction());

/** A new admin who signs in and enrols an authenticator; ends signed out. */
async function enrolledAdmin(email: string, role: "OWNER" | "ADMIN" | "EDITOR" = "OWNER") {
  const user = await createPasswordAdmin(prisma, { email, name: email.split("@")[0]!, role }, PASSWORD);
  expect((await signIn(email)).redirect).toBe("/admin/setup-mfa");
  const start = await enroll.startEnrollment(PASSWORD);
  if (!start.ok) throw new Error(start.error);
  const otp = createOTP(new TextDecoder().decode(base32.decode(start.secret)));
  expect(await enroll.confirmEnrollment(await otp.totp())).toEqual({ ok: true });
  await signOut();
  return { user, otp, backupCodes: start.backupCodes };
}

/** Password + authenticator code with "Trust this device" ticked; ends signed in. */
async function signInAndTrust(email: string, otp: { totp: () => Promise<string> }) {
  expect((await signIn(email)).redirect).toBe("/admin/login/verify?next=%2Fadmin");
  expect((await verify(await otp.totp(), { trust: true })).redirect).toBe("/admin");
  const token = cookieToken();
  expect(token).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
  return token!;
}

describe.skipIf(!hasTestDb)("trusted devices (skip the authenticator code for 30 days)", () => {
  beforeEach(async () => {
    await resetDb();
    req.resetRequest();
    req.request.userAgent = WINDOWS_CHROME;
  });

  it("creates a hashed, 30-day trusted device only after password AND authenticator code", async () => {
    const { user, otp } = await enrolledAdmin("owner@example.com");
    // Password alone never trusts anything.
    await signIn("owner@example.com");
    expect(cookieToken()).toBeNull();
    expect(await prisma.adminTrustedDevice.count()).toBe(0);
    // A wrong code with the box ticked trusts nothing.
    expect((await verify("000000", { trust: true })).returned).toMatchObject({ error: expect.any(String) });
    expect(await prisma.adminTrustedDevice.count()).toBe(0);

    expect((await verify(await otp.totp(), { trust: true })).redirect).toBe("/admin");
    const token = cookieToken()!;
    const device = await prisma.adminTrustedDevice.findFirstOrThrow();
    expect(device).toMatchObject({ userId: user.id, label: "Chrome on Windows", userAgent: WINDOWS_CHROME, firstSeenIp: "203.0.113.9", revokedAt: null, lastUsedAt: null });
    expect(device.expiresAt.getTime() - device.createdAt.getTime()).toBeGreaterThanOrEqual(30 * DAY - 5000);
    expect(device.expiresAt.getTime() - device.createdAt.getTime()).toBeLessThanOrEqual(30 * DAY + 5000);

    // Only the SHA-256 hash is stored; the raw token exists only in the cookie.
    expect(device.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(device)).not.toContain(token.slice(3));
    expect(token).not.toContain(device.id);
    const log = await prisma.activityLog.findMany({ where: { type: "admin.trusted_device_created" } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: user.id, entityType: "trusted_device", entityId: device.id, ipAddress: "203.0.113.9", userAgent: WINDOWS_CHROME });
    expect(JSON.stringify(await prisma.activityLog.findMany())).not.toContain(token.slice(3));
  });

  it("sets a narrowly scoped, HttpOnly, SameSite=Strict cookie (Secure in production)", () => {
    const expires = new Date(Date.now() + 30 * DAY);
    expect(trusted.trustedDeviceCookieOptions(expires)).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/admin/login", secure: false });
    expect(trusted.trustedDeviceCookieOptions(expires).maxAge).toBeGreaterThan(30 * 24 * 3600 - 5);
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(trusted.trustedDeviceCookieOptions(expires).secure).toBe(true);
      expect(trusted.trustedDeviceCookieName()).toBe("__Secure-wm_admin.trusted_device");
    } finally {
      vi.unstubAllEnvs();
    }
    expect(new Set(Array.from({ length: 50 }, () => trusted.newTrustedDeviceToken())).size).toBe(50);
  });

  it("skips the code on the trusted device, still requires the password, and never extends the expiry", async () => {
    const { otp } = await enrolledAdmin("owner@example.com");
    await signInAndTrust("owner@example.com", otp);
    const before = await prisma.adminTrustedDevice.findFirstOrThrow();
    await signOut();
    expect(await prisma.adminSession.count()).toBe(0);

    // Wrong password with a valid trusted cookie: refused, no session.
    expect((await signIn("owner@example.com", "not-the-password-1")).returned).toMatchObject({ error: expect.stringMatching(/isn't correct/) });
    expect(await prisma.adminSession.count()).toBe(0);
    // The plugin endpoint can't be used without Better Auth's password step (no pending challenge).
    expect(await getAuth().api.signInWithTrustedDevice({ headers: new Headers({ cookie: `${COOKIE}=${cookieToken()}` }) })).toEqual({ trusted: false, reason: "no_challenge" });
    expect(await prisma.adminSession.count()).toBe(0);

    // Correct password: straight in, no code.
    expect((await signIn("owner@example.com", PASSWORD, "/admin/quotes")).redirect).toBe("/admin/quotes");
    await expect(session.requireAdmin()).resolves.toMatchObject({ email: "owner@example.com" });
    const after = await prisma.adminTrustedDevice.findFirstOrThrow();
    expect(after.lastUsedAt).not.toBeNull();
    expect(after.lastSeenIp).toBe("203.0.113.9");
    expect(after.expiresAt).toEqual(before.expiresAt); // not extended
    expect(after.tokenHash).toBe(before.tokenHash);
    expect(await prisma.activityLog.count({ where: { type: "admin.trusted_device_used", entityId: after.id } })).toBe(1);
    // A trusted-device session hasn't proven the second factor.
    expect((await prisma.adminSession.findFirstOrThrow()).twoFactorVerifiedAt).toBeNull();

    // Normal session expiry still applies: an old session is rejected, and the password is needed again.
    await prisma.adminSession.updateMany({ data: { createdAt: new Date(Date.now() - 8 * DAY) } });
    expect(await session.getCurrentAdmin()).toBeNull();
    expect(await prisma.adminSession.count()).toBe(0);
    expect((await signIn("owner@example.com", "not-the-password-1")).returned).toMatchObject({ error: expect.any(String) });
    expect((await signIn("owner@example.com")).redirect).toBe("/admin");
  });

  it("expired, revoked, malformed and unknown cookies all require the code (and are cleared)", async () => {
    const { user, otp } = await enrolledAdmin("owner@example.com");
    await signInAndTrust("owner@example.com", otp);
    await signOut();
    const device = await prisma.adminTrustedDevice.findFirstOrThrow();

    // Expired after 30 days.
    await prisma.adminTrustedDevice.update({ where: { id: device.id }, data: { createdAt: new Date(Date.now() - 31 * DAY), expiresAt: new Date(Date.now() - DAY) } });
    expect((await signIn("owner@example.com")).redirect).toBe("/admin/login/verify?next=%2Fadmin");
    expect(cookieToken()).toBeNull();
    expect(await prisma.activityLog.findFirst({ where: { type: "admin.trusted_device_expired" } })).toMatchObject({ actorId: user.id, entityId: device.id });
    expect(await prisma.adminSession.count()).toBe(0);
    // …and they can choose to trust it again.
    expect((await verify(await otp.totp(), { trust: true })).redirect).toBe("/admin");
    expect(await prisma.adminTrustedDevice.count({ where: trusted.activeTrustedDevicesWhere(user.id) })).toBe(1);
    await signOut();

    // Revoked.
    await prisma.adminTrustedDevice.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "revoked" } });
    expect((await signIn("owner@example.com")).redirect).toMatch(/^\/admin\/login\/verify/);
    expect(cookieToken()).toBeNull();

    // Malformed, and well-formed but unknown.
    for (const bad of ["garbage", `v1.${"A".repeat(43)}`, `${device.id}`, `v1.${"x".repeat(10)}`]) {
      req.jar.set(COOKIE, bad);
      expect((await signIn("owner@example.com")).redirect, bad).toMatch(/^\/admin\/login\/verify/);
      expect(cookieToken(), bad).toBeNull();
    }
    expect(await prisma.adminSession.count()).toBe(0);
  });

  it("is per admin: another admin's token can't skip the code, and doesn't disturb the owner's trust", async () => {
    const a = await enrolledAdmin("alex@example.com");
    const b = await enrolledAdmin("blair@example.com");
    const alexToken = await signInAndTrust("alex@example.com", a.otp);
    await signOut();

    expect((await signIn("blair@example.com")).redirect).toMatch(/^\/admin\/login\/verify/);
    expect(await prisma.adminSession.count()).toBe(0);
    expect(cookieToken()).toBe(alexToken); // still Alex's
    expect(await trusted.checkTrustedDevice(alexToken, b.user.id)).toEqual({ ok: false, reason: "other_user" });
    // Blair finishes with a code; Alex's trust on this browser still works for Alex.
    expect((await verify(await b.otp.totp())).redirect).toBe("/admin");
    await signOut();
    expect((await signIn("alex@example.com")).redirect).toBe("/admin");
  });

  it("revokes trusted devices on password change, password reset, two-factor reset, sign-out-everywhere and deactivation", async () => {
    const owner = await enrolledAdmin("owner@example.com");
    const other = await enrolledAdmin("other@example.com", "ADMIN");
    const active = (userId: string) => prisma.adminTrustedDevice.count({ where: trusted.activeTrustedDevicesWhere(userId) });
    const seed = (userId: string) =>
      prisma.adminTrustedDevice.create({ data: { userId, tokenHash: trusted.hashTrustedDeviceToken(trusted.newTrustedDeviceToken()), label: "Test", expiresAt: new Date(Date.now() + DAY) } });

    // Own password change (signed in on the trusted device itself).
    await signInAndTrust("owner@example.com", owner.otp);
    expect(await active(owner.user.id)).toBe(1);
    expect(await security.changePassword(form({ currentPassword: PASSWORD, newPassword: "another-passphrase-2", confirmPassword: "another-passphrase-2" }))).toMatchObject({ ok: true });
    expect(await active(owner.user.id)).toBe(0);
    expect(await prisma.activityLog.findFirst({ where: { type: "admin.trusted_devices_revoked", entityId: owner.user.id } })).toMatchObject({
      message: expect.stringMatching(/password changed \(1 device\)/),
    });
    await signOut();
    expect((await signIn("owner@example.com", "another-passphrase-2")).redirect).toMatch(/^\/admin\/login\/verify/);

    // Owner actions on another admin (fresh owner session).
    req.jar.clear();
    await req.signInAs(owner.user.id);
    await seed(other.user.id);
    expect(await security.resetAdminPassword(other.user.id, form({ password: "a-reset-passphrase-3" }))).toMatchObject({ ok: true });
    expect(await active(other.user.id)).toBe(0);
    await seed(other.user.id);
    expect(await security.revokeAdminSessions(other.user.id)).toMatchObject({ ok: true });
    expect(await active(other.user.id)).toBe(0);
    await seed(other.user.id);
    expect(await security.resetAdminTwoFactor(other.user.id)).toMatchObject({ ok: true });
    expect(await active(other.user.id)).toBe(0);
    await seed(other.user.id);
    expect(await security.setAdminActive(other.user.id, false)).toMatchObject({ ok: true });
    expect(await active(other.user.id)).toBe(0);
    const reasons = (await prisma.activityLog.findMany({ where: { type: "admin.trusted_devices_revoked", entityId: other.user.id }, orderBy: { createdAt: "asc" } })).map((l) => l.message);
    expect(reasons).toEqual([
      expect.stringMatching(/password reset|password changed/),
      expect.stringMatching(/signed out everywhere/),
      expect.stringMatching(/two-factor reset/),
      expect.stringMatching(/account deactivated/),
    ]);

    // Replacing your own authenticator (2FA reconfigured / secret regenerated).
    await seed(owner.user.id);
    expect((await redirectOf(security.replaceAuthenticator(form({ password: "another-passphrase-2" })))).redirect).toBe("/admin/setup-mfa");
    expect(await active(owner.user.id)).toBe(0);
  });

  it("the database revokes devices whatever path changes the password, authenticator or status", async () => {
    const { user, otp } = await enrolledAdmin("owner@example.com");
    const make = async () => {
      const token = trusted.newTrustedDeviceToken();
      await prisma.adminTrustedDevice.create({ data: { userId: user.id, tokenHash: trusted.hashTrustedDeviceToken(token), label: "Test", expiresAt: new Date(Date.now() + DAY) } });
      return token;
    };
    const reasonOf = async (token: string) => (await prisma.adminTrustedDevice.findUniqueOrThrow({ where: { tokenHash: trusted.hashTrustedDeviceToken(token) } })).revokedReason;

    let t = await make();
    await prisma.adminAccount.updateMany({ where: { userId: user.id }, data: { password: "scrypt-hash-changed-elsewhere" } });
    expect(await reasonOf(t)).toBe("password_changed");

    t = await make();
    await prisma.adminAccount.updateMany({ where: { userId: user.id }, data: { scope: "unrelated" } }); // not the password
    expect(await reasonOf(t)).toBeNull();
    await prisma.adminTwoFactor.updateMany({ where: { userId: user.id }, data: { secret: "regenerated-secret" } });
    expect(await reasonOf(t)).toBe("two_factor_changed");

    t = await make();
    await prisma.adminTwoFactor.updateMany({ where: { userId: user.id }, data: { failedVerificationCount: 1 } }); // not the secret
    expect(await reasonOf(t)).toBeNull();
    await prisma.adminUser.update({ where: { id: user.id }, data: { active: false } });
    expect(await reasonOf(t)).toBe("account_disabled");

    // Even a device someone un-revoked by hand is refused while the account is disabled.
    await prisma.adminTrustedDevice.updateMany({ data: { revokedAt: null, revokedReason: null } });
    expect(await trusted.checkTrustedDevice(t, user.id)).toMatchObject({ ok: false, reason: "inactive" });
    expect(otp).toBeTruthy();
  });

  it("a deactivated admin can't sign in with a trusted device", async () => {
    const { user, otp } = await enrolledAdmin("owner@example.com", "ADMIN");
    await createPasswordAdmin(prisma, { email: "boss@example.com", name: "Boss", role: "OWNER" }, PASSWORD);
    await signInAndTrust("owner@example.com", otp);
    await signOut();
    await prisma.adminUser.update({ where: { id: user.id }, data: { active: false } });
    await prisma.adminTrustedDevice.updateMany({ data: { revokedAt: null, revokedReason: null } }); // even if not revoked
    const res = await signIn("owner@example.com");
    expect(res.redirect ?? "").not.toBe("/admin");
    expect(await prisma.adminSession.count()).toBe(0);
    expect(await session.getCurrentAdmin()).toBeNull();
  });

  it("lists devices without tokens, and revokes one or all", async () => {
    const { user, otp } = await enrolledAdmin("owner@example.com");
    await signInAndTrust("owner@example.com", otp);
    await signOut();
    req.jar.clear();
    req.request.userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    await signInAndTrust("owner@example.com", otp);
    const devices = await prisma.adminTrustedDevice.findMany({ where: trusted.activeTrustedDevicesWhere(user.id), orderBy: { createdAt: "asc" } });
    expect(devices.map((d) => d.label)).toEqual(["Chrome on Windows", "Safari on iPhone"]);

    expect(await security.renameMyTrustedDevice(devices[0]!.id, form({ label: "Office PC" }))).toMatchObject({ ok: true });
    expect(await security.revokeMyTrustedDevice(devices[0]!.id)).toMatchObject({ ok: true });
    expect(await security.revokeMyTrustedDevice(devices[0]!.id)).toMatchObject({ ok: false });
    expect(await prisma.adminTrustedDevice.findUniqueOrThrow({ where: { id: devices[0]!.id } })).toMatchObject({ label: "Office PC", revokedReason: "revoked", revokedById: user.id });
    expect(await prisma.activityLog.count({ where: { type: "admin.trusted_device_revoked", entityId: devices[0]!.id } })).toBe(1);

    // Another admin can't revoke or rename my devices.
    const other = await createPasswordAdmin(prisma, { email: "x@example.com", name: "X", role: "OWNER" }, PASSWORD);
    await prisma.adminUser.update({ where: { id: other.id }, data: { twoFactorEnabled: true } });
    const mine = new Map(req.jar);
    await req.signInAs(other.id);
    expect(await security.revokeMyTrustedDevice(devices[1]!.id)).toMatchObject({ ok: false });
    expect(await security.renameMyTrustedDevice(devices[1]!.id, form({ label: "Mine now" }))).toMatchObject({ ok: false });
    req.jar.clear();
    for (const [k, v] of mine) req.jar.set(k, v);

    expect(await security.revokeAllMyTrustedDevices()).toMatchObject({ ok: true, message: expect.stringMatching(/Revoked 1 trusted device/) });
    expect(await prisma.adminTrustedDevice.count({ where: trusted.activeTrustedDevicesWhere(user.id) })).toBe(0);
    expect(await prisma.activityLog.count({ where: { type: "admin.trusted_devices_revoked" } })).toBe(1);
    await signOut();
    expect((await signIn("owner@example.com")).redirect).toMatch(/^\/admin\/login\/verify/);
  });

  it("a backup code never establishes device trust", async () => {
    const { backupCodes } = await enrolledAdmin("owner@example.com");
    await signIn("owner@example.com");
    expect((await verify(backupCodes[0]!, { method: "backup", trust: true })).redirect).toBe("/admin");
    expect(await prisma.adminTrustedDevice.count()).toBe(0);
    expect(cookieToken()).toBeNull();
  });

  it("a trusted device skips only the code: roles still apply, and owner security changes need a fresh code", async () => {
    const owner = await enrolledAdmin("owner@example.com");
    const editor = await enrolledAdmin("editor@example.com", "EDITOR");

    await signInAndTrust("editor@example.com", editor.otp);
    await signOut();
    expect((await signIn("editor@example.com")).redirect).toBe("/admin");
    await expect(session.requireAdmin()).rejects.toThrow(/REDIRECT \/admin\?denied=1/);
    expect(await products.duplicateProduct("anything")).toMatchObject({ ok: false, message: expect.stringMatching(/role/) });
    expect(await security.createAdminUser(form({ name: "Eve", email: "eve@example.com", role: "OWNER", password: "a-good-passphrase-9" }))).toMatchObject({ ok: false });
    await signOut();

    req.jar.clear();
    await signInAndTrust("owner@example.com", owner.otp);
    await signOut();
    expect((await signIn("owner@example.com")).redirect).toBe("/admin");
    const newOwner = () => security.createAdminUser(form({ name: "Sam", email: "sam@example.com", role: "OWNER", password: "a-good-passphrase-9" }));
    expect(await newOwner()).toMatchObject({ ok: false, message: expect.stringMatching(/confirm it's you/i) });
    expect(await security.setAdminRole(editor.user.id, "OWNER")).toMatchObject({ ok: false, message: expect.stringMatching(/confirm it's you/i) });
    expect(await security.revokeAdminSessions(editor.user.id)).toMatchObject({ ok: false });
    expect(await prisma.adminUser.count({ where: { email: "sam@example.com" } })).toBe(0);

    expect(await security.confirmIdentity(form({ code: "000000" }))).toMatchObject({ ok: false });
    expect(await security.confirmIdentity(form({ code: await owner.otp.totp() }))).toMatchObject({ ok: true });
    expect(await newOwner()).toMatchObject({ ok: true });
    expect(await security.setAdminRole(editor.user.id, "ADMIN")).toMatchObject({ ok: true });
    expect(await prisma.activityLog.count({ where: { type: "admin.reauthenticated" } })).toBe(1);

    // The confirmation lapses after 15 minutes.
    await prisma.adminSession.updateMany({ data: { twoFactorVerifiedAt: new Date(Date.now() - 16 * 60 * 1000) } });
    expect(await security.setAdminRole(editor.user.id, "EDITOR")).toMatchObject({ ok: false, message: expect.stringMatching(/confirm it's you/i) });
  });
});
