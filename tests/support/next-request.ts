/**
 * Stand-ins for Next.js request APIs in integration tests. Cookies live in a
 * jar that also feeds the request's Cookie header, so Better Auth reads the
 * session exactly as it would from a browser, and cookies it sets (sign-in,
 * sign-out) land back in the jar.
 *
 *   vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
 *   vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
 *   vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);
 */
export const jar = new Map<string, string>();
export const request = { ip: "203.0.113.9", userAgent: "vitest", origin: "http://localhost:3000" as string | null, draftMode: false };

export function resetRequest() {
  jar.clear();
  request.draftMode = false;
  request.ip = "203.0.113.9";
  request.userAgent = "vitest";
  request.origin = "http://localhost:3000";
}

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export const nextHeaders = {
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: decodeURIComponent(jar.get(name)!) } : undefined),
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value: decodeURIComponent(value) })),
    has: (name: string) => jar.has(name),
    set: (name: string | { name: string; value: string; maxAge?: number }, value?: string, opts?: { maxAge?: number; expires?: Date }) => {
      const n = typeof name === "string" ? name : name.name;
      const v = typeof name === "string" ? (value ?? "") : name.value;
      const maxAge = typeof name === "string" ? opts?.maxAge : name.maxAge;
      if (v === "" || maxAge === 0 || (opts?.expires && opts.expires.getTime() < Date.now())) jar.delete(n);
      else jar.set(n, encodeURIComponent(v)); // Next.js URL-encodes cookie values when writing them
    },
    delete: (name: string) => void jar.delete(name),
  }),
  // Next.js Draft Mode (the preview cookie). Tests flip it directly.
  draftMode: async () => ({
    get isEnabled() {
      return request.draftMode;
    },
    enable: () => void (request.draftMode = true),
    disable: () => void (request.draftMode = false),
  }),
  headers: async () => {
    const h = new Headers({ "user-agent": request.userAgent, "x-real-ip": request.ip });
    if (request.origin) h.set("origin", request.origin);
    const cookie = cookieHeader();
    if (cookie) h.set("cookie", cookie);
    return h;
  },
};

export const nextNavigation = {
  redirect: (url: string) => {
    throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
  notFound: () => {
    throw Object.assign(new Error("NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  },
};

export const nextCache = { revalidatePath: () => undefined, revalidateTag: () => undefined };

/** Sign the test request in as an admin (session row + signed cookie). */
export async function signInAs(userId: string, opts: { ageMs?: number; idleMs?: number } = {}) {
  const { prisma } = await import("@/lib/db");
  const { mintAdminSession } = await import("@/lib/auth/mint-session");
  const s = await mintAdminSession(prisma, userId, opts);
  jar.set(s.cookieName, s.cookieValue);
  return s.session;
}

/** A fully enrolled admin (two-factor on) with a credential password, signed in. */
export async function createSignedInAdmin(opts: { role?: "OWNER" | "ADMIN" | "EDITOR"; email?: string; password?: string; signIn?: boolean } = {}) {
  const { prisma } = await import("@/lib/db");
  const { createPasswordAdmin } = await import("@/lib/auth/accounts");
  const email = opts.email ?? "owner@example.com";
  const created = await createPasswordAdmin(
    prisma,
    { email, name: email.split("@")[0]!.replace(/^./, (c) => c.toUpperCase()), role: opts.role ?? "OWNER" },
    opts.password ?? "a-good-passphrase-1",
  );
  const user = await prisma.adminUser.update({ where: { id: created.id }, data: { twoFactorEnabled: true } });
  if (opts.signIn !== false) await signInAs(user.id);
  return user;
}
