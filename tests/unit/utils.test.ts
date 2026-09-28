import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { centsToDollarInput, formatCents, formatModifier, parseDollarsToCents } from "@/lib/money";
import { isValidSlug, slugify, uniqueSlug } from "@/lib/slug";
import { generateReference } from "@/lib/references";
import { verifyStripeWebhook } from "@/lib/commerce/payments/stripe";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/tokens";

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
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("correct horse 42");
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse 42", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
  it("enforces password strength", () => {
    expect(validatePasswordStrength("short1")).not.toBeNull();
    expect(validatePasswordStrength("longpasswordonly")).not.toBeNull();
    expect(validatePasswordStrength("a-much-better-passphrase-7")).toBeNull();
  });
  it("stores only a hash of session tokens", () => {
    const token = generateSessionToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(token)).not.toBe(token);
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
