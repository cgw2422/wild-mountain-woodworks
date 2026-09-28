import { describe, expect, it } from "vitest";
import { resolveConfigurableProduct } from "@/lib/pricing/resolve";
import { defaultSelection, priceConfiguration } from "@/lib/pricing/engine";
import { ridgeRecord } from "../support/fixtures";

describe("per-product overrides of the global option library", () => {
  it("disables values for one product only", () => {
    const record = ridgeRecord();
    record.optionGroups[1]!.valueOverrides = [
      { optionValueId: "wood-pine", enabled: false, priceModifierOverrideCents: null, displayOrderOverride: null, isDefault: false },
    ];
    const product = resolveConfigurableProduct(record);
    const wood = product.optionGroups.find((g) => g.id === "wood")!;
    expect(wood.values.map((v) => v.name)).toEqual(["Oak", "Maple", "Walnut"]);
    // A disabled value can't be submitted even if a client sends it.
    const r = priceConfiguration(product, { options: { size: "size-60", wood: "wood-pine" }, addOns: {} });
    expect(r.valid).toBe(false);
  });

  it("overrides a value's price and display order, and sets a default", () => {
    const record = ridgeRecord();
    record.optionGroups[1]!.valueOverrides = [
      { optionValueId: "wood-walnut", enabled: true, priceModifierOverrideCents: 45000, displayOrderOverride: -1, isDefault: true },
    ];
    const product = resolveConfigurableProduct(record);
    const wood = product.optionGroups.find((g) => g.id === "wood")!;
    expect(wood.values[0]!.name).toBe("Walnut");
    expect(wood.values[0]!.priceModifierCents).toBe(45000);
    expect(defaultSelection(product).options.wood).toBe("wood-walnut");
    // Values without an override row inherit global settings.
    expect(wood.values.find((v) => v.name === "Oak")!.priceModifierCents).toBe(30000);
  });

  it("hides inactive global values and inactive groups everywhere", () => {
    const record = ridgeRecord();
    record.optionGroups[0]!.optionGroup.values.find((v) => v.name === "96")!.active = false;
    record.optionGroups[1]!.optionGroup.active = false;
    const product = resolveConfigurableProduct(record);
    expect(product.optionGroups.map((g) => g.id)).toEqual(["size"]);
    expect(product.optionGroups[0]!.values.some((v) => v.name === "96")).toBe(false);
  });

  it("respects group required/display-name overrides", () => {
    const record = ridgeRecord();
    record.optionGroups[1]!.requiredOverride = false;
    record.optionGroups[1]!.displayNameOverride = "Species";
    const product = resolveConfigurableProduct(record);
    const wood = product.optionGroups.find((g) => g.id === "wood")!;
    expect(wood.required).toBe(false);
    expect(wood.displayName).toBe("Species");
    expect(priceConfiguration(product, { options: { size: "size-60" }, addOns: {} }).valid).toBe(true);
  });

  it("applies add-on overrides and drops disabled or archived add-ons", () => {
    const record = ridgeRecord();
    record.addOns[0]!.priceOverrideCents = 32500;
    record.addOns[0]!.maxQuantityOverride = 4;
    record.addOns[1]!.addOn.archivedAt = new Date();
    const product = resolveConfigurableProduct(record);
    expect(product.addOns).toHaveLength(1);
    expect(product.addOns[0]!.priceCents).toBe(32500);
    expect(product.addOns[0]!.maxQuantity).toBe(4);

    const disabled = ridgeRecord();
    disabled.addOns[0]!.enabled = false;
    expect(resolveConfigurableProduct(disabled).addOns.map((a) => a.id)).toEqual(["breadboard"]);
  });

  it("orders groups by the product's display order", () => {
    const record = ridgeRecord();
    record.optionGroups[0]!.displayOrder = 5;
    expect(resolveConfigurableProduct(record).optionGroups.map((g) => g.id)).toEqual(["wood", "size"]);
  });
});
