import { describe, expect, it } from "vitest";
import { defaultSelection, priceConfiguration, startingPrice } from "@/lib/pricing/engine";
import { resolveConfigurableProduct } from "@/lib/pricing/resolve";
import { ridgeRecord } from "../support/fixtures";

const ridge = () => resolveConfigurableProduct(ridgeRecord());

describe("priceConfiguration", () => {
  it("calculates base + option modifiers + add-ons (the example from the brief)", () => {
    // $1,200 base, 84" (+$300), Walnut (+$800), Matching Bench (+$350) = $2,650
    const result = priceConfiguration(ridge(), {
      options: { size: "size-84", wood: "wood-walnut" },
      addOns: { bench: 1 },
    });
    expect(result.valid).toBe(true);
    expect(result.totalCents).toBe(120000 + 30000 + 80000 + 35000);
    expect(result.lines.map((l) => l.kind)).toEqual(["base", "option", "option", "addon"]);
  });

  it("multiplies add-on price by quantity", () => {
    const r = priceConfiguration(ridge(), { options: { size: "size-60", wood: "wood-pine" }, addOns: { bench: 2 } });
    expect(r.totalCents).toBe(120000 + 2 * 35000);
  });

  it("requires every required option group", () => {
    const r = priceConfiguration(ridge(), { options: { size: "size-60" }, addOns: {} });
    expect(r.valid).toBe(false);
    expect(r.errors.wood).toMatch(/choose a wood/i);
  });

  it("rejects values that don't belong to the product", () => {
    const r = priceConfiguration(ridge(), { options: { size: "size-60", wood: "wood-mahogany" }, addOns: {} });
    expect(r.valid).toBe(false);
    expect(r.errors.wood).toBeDefined();
  });

  it("rejects unknown option groups and add-ons (tampered selections)", () => {
    const r = priceConfiguration(ridge(), { options: { size: "size-60", wood: "wood-pine", hacker: "x" }, addOns: { freebie: 1 } });
    expect(r.valid).toBe(false);
    expect(r.errors._form).toBeDefined();
  });

  it("enforces add-on quantity bounds", () => {
    const tooMany = priceConfiguration(ridge(), { options: { size: "size-60", wood: "wood-pine" }, addOns: { bench: 3 } });
    expect(tooMany.valid).toBe(false);
    const negative = priceConfiguration(ridge(), { options: { size: "size-60", wood: "wood-pine" }, addOns: { breadboard: -1 } });
    expect(negative.valid).toBe(false);
  });

  it("requires details for custom values and flags the configuration for a custom quote", () => {
    const missing = priceConfiguration(ridge(), { options: { size: "size-custom", wood: "wood-oak" }, addOns: {} });
    expect(missing.valid).toBe(false);
    expect(missing.errors.size).toMatch(/describe/i);
    const ok = priceConfiguration(ridge(), { options: { size: "size-custom", wood: "wood-oak" }, addOns: {}, customDetails: { size: "78 x 40" } });
    expect(ok.valid).toBe(true);
    expect(ok.requiresCustomQuote).toBe(true);
  });

  it("returns a null total when the product has no base price", () => {
    const product = resolveConfigurableProduct(ridgeRecord({ basePriceCents: null }));
    const r = priceConfiguration(product, { options: { size: "size-60", wood: "wood-pine" }, addOns: {} });
    expect(r.valid).toBe(true);
    expect(r.totalCents).toBeNull();
  });

  it("enforces required add-ons", () => {
    const record = ridgeRecord();
    record.addOns[1]!.requiredOverride = true;
    const product = resolveConfigurableProduct(record);
    const r = priceConfiguration(product, { options: { size: "size-60", wood: "wood-pine" }, addOns: {} });
    expect(r.valid).toBe(false);
    expect(r.errors.breadboard).toMatch(/required/i);
    expect(defaultSelection(product).addOns.breadboard).toBe(1);
  });
});

describe("startingPrice / defaultSelection", () => {
  it("starting price uses the cheapest non-custom value of each required group", () => {
    expect(startingPrice(ridge())).toBe(120000);
  });

  it("default selection picks each group's first non-custom value and produces a valid configuration", () => {
    const product = ridge();
    const sel = defaultSelection(product);
    expect(sel.options).toEqual({ size: "size-60", wood: "wood-pine" });
    expect(priceConfiguration(product, sel).valid).toBe(true);
  });
});
