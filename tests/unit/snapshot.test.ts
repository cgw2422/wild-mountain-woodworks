import { describe, expect, it } from "vitest";
import { resolveConfigurableProduct } from "@/lib/pricing/resolve";
import { priceConfiguration } from "@/lib/pricing/engine";
import { buildConfigurationSnapshot, parseSnapshot } from "@/lib/pricing/snapshot";
import { ridgeRecord } from "../support/fixtures";

describe("configuration snapshots", () => {
  const product = resolveConfigurableProduct(ridgeRecord());
  const selection = { options: { size: "size-custom", wood: "wood-walnut" }, addOns: { bench: 2 }, customDetails: { size: "  80 x 42 in " } };
  const pricing = priceConfiguration(product, selection);
  const now = new Date("2026-09-01T12:00:00Z");
  const snapshot = buildConfigurationSnapshot(product, selection, pricing, { priceShownToCustomer: true, now });

  it("copies names, selections and prices at the time of capture", () => {
    expect(snapshot.product).toEqual({ id: "ridge", name: "The Ridge Dining Table", slug: "ridge-dining-table", sku: "WM-RDT" });
    expect(snapshot.options).toEqual([
      expect.objectContaining({ groupDisplayName: "Size", valueDisplayName: "Custom", isCustom: true, customDetails: "80 x 42 in", priceModifierCents: 0 }),
      expect.objectContaining({ groupName: "Wood Species", valueName: "Walnut", priceModifierCents: 80000 }),
    ]);
    expect(snapshot.addOns).toEqual([{ addOnId: "bench", name: "Matching Bench", unitPriceCents: 35000, quantity: 2, totalCents: 70000 }]);
    expect(snapshot.totalCents).toBe(120000 + 80000 + 70000);
    expect(snapshot.requiresCustomQuote).toBe(true);
    expect(snapshot.capturedAt).toBe(now.toISOString());
  });

  it("is unaffected by later edits to the product (historical safety)", () => {
    const stored = JSON.parse(JSON.stringify(snapshot));
    // Owner renames the product, reprices walnut and renames the add-on.
    const record = ridgeRecord({ name: "The Ridge Table (2027)" });
    record.optionGroups[1]!.optionGroup.values.find((v) => v.name === "Walnut")!.priceModifierCents = 99900;
    record.addOns[0]!.addOn.name = "Bench";
    const edited = resolveConfigurableProduct(record);
    expect(edited.name).not.toBe(stored.product.name);
    // The stored snapshot still describes exactly what was requested.
    const parsed = parseSnapshot(stored)!;
    expect(parsed.product.name).toBe("The Ridge Dining Table");
    expect(parsed.options[1]!.priceModifierCents).toBe(80000);
    expect(parsed.addOns[0]!.name).toBe("Matching Bench");
  });

  it("refuses to snapshot an invalid configuration", () => {
    const bad = priceConfiguration(product, { options: {}, addOns: {} });
    expect(() => buildConfigurationSnapshot(product, { options: {}, addOns: {} }, bad, { priceShownToCustomer: false })).toThrow();
  });

  it("parseSnapshot rejects malformed JSON", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ version: 2 })).toBeNull();
    expect(parseSnapshot({ version: 1, product: {}, options: [], addOns: [] })).not.toBeNull();
  });
});
