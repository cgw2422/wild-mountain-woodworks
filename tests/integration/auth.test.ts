import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal stand-ins for Next.js request APIs.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));

const { prisma } = await import("@/lib/db");
const { hashPassword } = await import("@/lib/auth/password");
const session = await import("@/lib/auth/session");
const { SESSION_COOKIE, hashSessionToken } = await import("@/lib/auth/tokens");
const { rateLimit } = await import("@/lib/rate-limit");
const { hasTestDb, resetDb } = await import("../support/db");
const { checkPublicSubmission } = await import("@/lib/services/abuse");

describe.skipIf(!hasTestDb)("admin authentication", () => {
  beforeEach(async () => {
    await resetDb();
    jar.clear();
  });

  async function user(active = true) {
    return prisma.adminUser.create({ data: { email: "owner@example.com", name: "Owner", passwordHash: await hashPassword("a-good-passphrase-1"), active } });
  }

  it("creates a DB-backed session stored only as a hash, and validates it", async () => {
    const u = await user();
    await session.createAdminSession(u.id);
    const token = jar.get(SESSION_COOKIE)!;
    expect(token).toBeTruthy();
    const row = await prisma.adminSession.findFirstOrThrow();
    expect(row.tokenHash).toBe(hashSessionToken(token));
    expect(row.tokenHash).not.toBe(token);
    expect(row.ipAddress).toBe("203.0.113.9");
    await expect(session.requireAdmin()).resolves.toMatchObject({ email: "owner@example.com" });
  });

  it("rejects missing, forged, expired and deactivated sessions", async () => {
    await expect(session.requireAdmin()).rejects.toThrow(/REDIRECT \/admin\/login/);

    jar.set(SESSION_COOKIE, "forged-token");
    expect(await session.getCurrentAdmin()).toBeNull();

    const u = await user();
    await session.createAdminSession(u.id);
    await prisma.adminSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await session.getCurrentAdmin()).toBeNull();

    await prisma.adminSession.updateMany({ data: { expiresAt: new Date(Date.now() + 60_000) } });
    await prisma.adminUser.update({ where: { id: u.id }, data: { active: false } });
    expect(await session.getCurrentAdmin()).toBeNull();
  });

  it("signs out by deleting the session", async () => {
    const u = await user();
    await session.createAdminSession(u.id);
    await session.destroyCurrentSession();
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await prisma.adminSession.count()).toBe(0);
  });

  it("rate limits repeated attempts with a fixed window", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await rateLimit("login:test", 3, 60)).allowed);
    expect(results).toEqual([true, true, true, false]);
    await prisma.rateLimitBucket.update({ where: { key: "login:test" }, data: { resetAt: new Date(Date.now() - 1) } });
    expect((await rateLimit("login:test", 3, 60)).allowed).toBe(true);
  });
});

describe.skipIf(!hasTestDb)("public form abuse protection", () => {
  beforeEach(resetDb);

  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
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
