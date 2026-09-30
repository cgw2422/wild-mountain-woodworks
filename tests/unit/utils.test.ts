import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { centsToDollarInput, formatCents, formatModifier, parseDollarsToCents } from "@/lib/money";
import { isValidSlug, slugify, uniqueSlug } from "@/lib/slug";
import { generateReference } from "@/lib/references";
import { verifyStripeWebhook } from "@/lib/sales/stripe";
import { verifyPassword } from "better-auth/crypto";
import { hashAdminPassword, validatePasswordStrength } from "@/lib/auth/password";
import { clientIpFromHeaders } from "@/lib/auth/client-ip";

describe("money", () => {
  it("formats and parses cents without floating point drift", () => {
    expect(formatCents(129500)).toBe("$1,295");
    expect(formatCents(12950)).toBe("$129.50");
    expect(formatModifier(15000)).toBe("+$150");
    expect(formatModifier(-5000)).toBe("−$50");
    expect(formatModifier(0)).toBe("");
    expect(parseDollarsToCents("1,295.5")).toBe(129550);
    expect(parseDollarsToCents("$0.07")).toBe(7);
    expect(parseDollarsToCents("-25")).toBe(-2500);
    expect(parseDollarsToCents("")).toBeNull();
    expect(Number.isNaN(parseDollarsToCents("12.345"))).toBe(true);
    expect(centsToDollarInput(129550)).toBe("1295.50");
    expect(centsToDollarInput(-2500)).toBe("-25");
  });
});

describe("slugs", () => {
  it("creates clean slugs", () => {
    expect(slugify("The Ridge Dining Table")).toBe("the-ridge-dining-table");
    expect(slugify("  Café & Bench — Walnut's ")).toBe("cafe-and-bench-walnuts");
    expect(isValidSlug("ridge-dining-table")).toBe(true);
    expect(isValidSlug("Ridge Table")).toBe(false);
  });
  it("avoids collisions", async () => {
    const taken = new Set(["ridge", "ridge-2"]);
    expect(await uniqueSlug("Ridge", async (s) => taken.has(s))).toBe("ridge-3");
  });
});

describe("references", () => {
  it("generates readable, dated references", () => {
    const ref = generateReference("Q", new Date("2026-09-27T10:00:00Z"));
    expect(ref).toMatch(/^WM-Q-260927-[2-9A-HJKMNP-Z]{4}$/);
  });
});

describe("auth primitives", () => {
  it("hashes passwords with scrypt (salted, never plain text)", async () => {
    const hash = await hashAdminPassword("correct horse 42");
    expect(hash).not.toContain("correct horse");
    expect(hash).not.toBe(await hashAdminPassword("correct horse 42"));
    expect(await verifyPassword({ hash, password: "correct horse 42" })).toBe(true);
    expect(await verifyPassword({ hash, password: "wrong" })).toBe(false);
  });
  it("enforces password strength", () => {
    expect(validatePasswordStrength("short1")).not.toBeNull();
    expect(validatePasswordStrength("longpasswordonly")).not.toBeNull();
    expect(validatePasswordStrength("a-much-better-passphrase-7")).toBeNull();
  });
  it("never trusts the client-supplied first X-Forwarded-For entry", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "6.6.6.6" }))).toBe("198.51.100.4");
    expect(clientIpFromHeaders(new Headers({ "cf-connecting-ip": "6.6.6.6", "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4"); // not behind Cloudflare
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });

});

describe("Stripe webhook verification", () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
  const sign = (t: number, body = payload) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
  const now = 1_800_000_000_000;

  it("accepts a correctly signed, recent event", () => {
    const event = verifyStripeWebhook(payload, sign(now / 1000), secret, 300, now);
    expect(event.type).toBe("checkout.session.completed");
  });
  it("rejects tampered payloads, bad signatures and stale timestamps", () => {
    expect(() => verifyStripeWebhook(payload.replace("cs_1", "cs_2"), sign(now / 1000), secret, 300, now)).toThrow();
    expect(() => verifyStripeWebhook(payload, "t=1,v1=deadbeef", secret, 300, now)).toThrow();
    expect(() => verifyStripeWebhook(payload, sign(now / 1000 - 3600), secret, 300, now)).toThrow(/tolerance/);
    expect(() => verifyStripeWebhook(payload, null, secret)).toThrow();
  });
});
