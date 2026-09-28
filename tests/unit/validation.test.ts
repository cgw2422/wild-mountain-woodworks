import { describe, expect, it } from "vitest";
import { configurationQuoteSchema, contactSchema, customRequestSchema, generalQuoteSchema } from "@/lib/validation/forms";
import { precheckImageFile } from "@/lib/media/validate";

const person = { name: "Jamie Rivers", email: "Jamie@Example.com ", zipCode: "43215" };

describe("public form validation", () => {
  it("accepts a valid configuration request and normalizes fields", () => {
    const r = configurationQuoteSchema.parse({
      ...person,
      productId: "p1",
      phone: "",
      notes: "",
      selection: JSON.stringify({ options: { g: "v" }, addOns: { a: 2 } }),
    });
    expect(r.email).toBe("jamie@example.com");
    expect(r.phone).toBeNull();
    expect(r.notes).toBeNull();
    expect(r.selection.options).toEqual({ g: "v" });
    expect(r.selection.customDetails).toEqual({});
  });

  it("rejects malformed configuration JSON and bad add-on quantities", () => {
    expect(configurationQuoteSchema.safeParse({ ...person, productId: "p1", selection: "{not json" }).success).toBe(false);
    expect(
      configurationQuoteSchema.safeParse({ ...person, productId: "p1", selection: JSON.stringify({ options: {}, addOns: { a: 1000 } }) }).success,
    ).toBe(false);
  });

  it("does not accept prices from the client (no price field exists)", () => {
    const r = configurationQuoteSchema.parse({ ...person, productId: "p1", selection: JSON.stringify({ options: {}, addOns: {} }), totalCents: "1" });
    expect(r).not.toHaveProperty("totalCents");
  });

  it("validates email, ZIP code and phone", () => {
    const bad = generalQuoteSchema.safeParse({ interest: "Table", name: "A", email: "nope", zipCode: "4321", phone: "call me" });
    expect(bad.success).toBe(false);
    const keys = bad.error!.issues.map((i) => i.path[0]);
    expect(keys).toEqual(expect.arrayContaining(["name", "email", "zipCode", "phone"]));
    expect(generalQuoteSchema.safeParse({ interest: "Table", ...person, zipCode: "43215-1234", phone: "+1 (614) 555-0100" }).success).toBe(true);
  });

  it("requires a description for custom requests and a valid reason for contact messages", () => {
    expect(customRequestSchema.safeParse({ ...person, furnitureType: "Table", description: "short" }).success).toBe(false);
    expect(customRequestSchema.safeParse({ ...person, furnitureType: "Table", description: "A long walnut table for ten people." }).success).toBe(true);
    expect(contactSchema.safeParse({ ...person, reason: "SPAM", message: "Hello there, a question." }).success).toBe(false);
    expect(contactSchema.safeParse({ ...person, reason: "OTHER", message: "Hello there, a question." }).success).toBe(true);
  });

  it("enforces length limits", () => {
    expect(contactSchema.safeParse({ ...person, reason: "OTHER", message: "x".repeat(5001) }).success).toBe(false);
  });
});

describe("upload restrictions", () => {
  const f = (name: string, type: string, size = 1000) => ({ name, type, size });
  it("allows JPG/PNG/WebP/AVIF with matching extensions", () => {
    expect(precheckImageFile(f("a.jpg", "image/jpeg"), 10_000)).toBeNull();
    expect(precheckImageFile(f("a.JPEG", "image/jpeg"), 10_000)).toBeNull();
    expect(precheckImageFile(f("a.webp", "image/webp"), 10_000)).toBeNull();
  });
  it("rejects wrong types, mismatched extensions, empty and oversized files", () => {
    expect(precheckImageFile(f("a.svg", "image/svg+xml"), 10_000)).toMatch(/not a supported/);
    expect(precheckImageFile(f("a.png", "image/jpeg"), 10_000)).toMatch(/extension/);
    expect(precheckImageFile(f("a.jpg", "image/jpeg", 0), 10_000)).toMatch(/empty/);
    expect(precheckImageFile(f("a.jpg", "image/jpeg", 20_000), 10_000)).toMatch(/larger/);
  });
});
