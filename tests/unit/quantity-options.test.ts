import { describe, expect, it } from "vitest";
import { defaultSelection, priceConfiguration, quantityIssue, startingPrice } from "@/lib/pricing/engine";
import { quantitySpec, resolveConfigurableProduct, type ProductConfigRecord } from "@/lib/pricing/resolve";
import { buildConfigurationSnapshot, snapshotOptionLabel, snapshotOptionTotal, type ConfigurationSnapshot } from "@/lib/pricing/snapshot";
import { ridgeRecord } from "../support/fixtures";

/** The Ridge table plus an optional "Add Dining Chairs" group: Cross Back Chair, $192.50 each, 0–8, default 0. */
function withChairs(chair: Partial<ProductConfigRecord["optionGroups"][number]["optionGroup"]["values"][number]> = {}, required = false) {
  const base = ridgeRecord();
  return resolveConfigurableProduct({
    ...base,
    optionGroups: [
      ...base.optionGroups,
      {
        displayOrder: 2,
        requiredOverride: null,
        displayNameOverride: null,
        valueOverrides: [],
        optionGroup: {
          id: "chairs",
          name: "Dining Chairs",
          displayName: "Add Dining Chairs",
          description: null,
          inputType: "RADIO",
          required,
          active: true,
          values: [
            {
              id: "chairs-crossback",
              name: "Cross Back Chair",
              displayName: "Cross Back Chair",
              description: null,
              priceModifierCents: 19250,
              isCustom: false,
              quantityEnabled: true,
              quantityMin: 0,
              quantityMax: 8,
              quantityStep: 1,
              quantityDefault: 0,
              displayOrder: 0,
              active: true,
              swatchColor: null,
              image: null,
              ...chair,
            },
          ],
        },
      },
    ],
  });
}

const table = { size: "size-60", wood: "wood-pine" }; // $1,200

describe("quantity-based option values", () => {
  it("prices the option as unit price × quantity and adds it to the total", () => {
    const r = priceConfiguration(withChairs(), { options: { ...table, chairs: "chairs-crossback" }, optionQuantities: { chairs: 4 }, addOns: {} });
    expect(r.valid).toBe(true);
    expect(r.totalCents).toBe(120000 + 4 * 19250); // $1,970
    expect(r.lines.find((l) => l.label === "Add Dining Chairs")).toEqual({ kind: "option", label: "Add Dining Chairs", detail: "Cross Back Chair", quantity: 4, unitCents: 19250, amountCents: 77000 });
  });

  it("allows 0 — the table without chairs — and adds nothing", () => {
    const r = priceConfiguration(withChairs(), { options: { ...table, chairs: "chairs-crossback" }, optionQuantities: { chairs: 0 }, addOns: {} });
    expect(r).toMatchObject({ valid: true, totalCents: 120000 });
    expect(r.lines.some((l) => l.label === "Add Dining Chairs")).toBe(false);
    // Not choosing the (optional) group at all is the same price.
    expect(priceConfiguration(withChairs(), { options: table, addOns: {} }).totalCents).toBe(120000);
  });

  it("uses the value's default quantity when none was sent", () => {
    const p = withChairs({ quantityDefault: 2 });
    expect(priceConfiguration(p, { options: { ...table, chairs: "chairs-crossback" }, addOns: {} }).totalCents).toBe(120000 + 2 * 19250);
  });

  it("enforces minimum, maximum, step and whole numbers (tampered quantities are rejected)", () => {
    const p = withChairs({ quantityMin: 2, quantityMax: 8, quantityStep: 2, quantityDefault: 2 });
    const price = (q: number) => priceConfiguration(p, { options: { ...table, chairs: "chairs-crossback" }, optionQuantities: { chairs: q }, addOns: {} });
    for (const ok of [2, 4, 6, 8]) expect(price(ok).valid, String(ok)).toBe(true);
    for (const bad of [0, 1, 3, 9, 10, -2, 2.5, Number.NaN]) {
      const r = price(bad);
      expect(r.valid, String(bad)).toBe(false);
      expect(r.errors.chairs).toMatch(/between 2 and 8, in steps of 2/);
    }
    expect(quantityIssue(4, { min: 0, max: 8, step: 1, default: 0 })).toBeNull();
  });

  it("ignores a quantity sent for an ordinary (non-quantity) value", () => {
    const r = priceConfiguration(withChairs(), { options: table, optionQuantities: { size: 5, wood: 99 }, addOns: {} });
    expect(r).toMatchObject({ valid: true, totalCents: 120000 });
  });

  it("defaults and 'From' prices account for quantities", () => {
    const p = withChairs({ quantityDefault: 4 });
    const sel = defaultSelection(p);
    expect(sel.optionQuantities).toEqual({}); // optional group, nothing preselected
    const req = withChairs({ quantityMin: 2, quantityDefault: 4 }, true);
    expect(defaultSelection(req)).toMatchObject({ options: { chairs: "chairs-crossback" }, optionQuantities: { chairs: 4 } });
    // A required quantity group's cheapest choice is the minimum quantity.
    expect(startingPrice(req)).toBe(120000 + 2 * 19250);
    expect(startingPrice(withChairs())).toBe(120000);
  });

  it("normalizes stored settings into a valid range", () => {
    expect(quantitySpec({ quantityEnabled: false, quantityMax: 8 })).toBeNull();
    expect(quantitySpec({ quantityEnabled: true, quantityMin: 0, quantityMax: 8, quantityStep: 1, quantityDefault: 0 })).toEqual({ min: 0, max: 8, step: 1, default: 0 });
    expect(quantitySpec({ quantityEnabled: true, quantityMin: 2, quantityMax: 8, quantityStep: 2, quantityDefault: 5 })).toEqual({ min: 2, max: 8, step: 2, default: 4 });
    expect(quantitySpec({ quantityEnabled: true, quantityMin: 5, quantityMax: 1, quantityStep: 0, quantityDefault: 9 })).toEqual({ min: 5, max: 5, step: 1, default: 5 });
  });

  it("leaves ordinary options exactly as before", () => {
    const p = withChairs();
    expect(p.optionGroups.find((g) => g.id === "size")!.values.every((v) => v.quantity === null)).toBe(true);
    const r = priceConfiguration(p, { options: { size: "size-84", wood: "wood-walnut" }, addOns: { bench: 1 } });
    expect(r.totalCents).toBe(120000 + 30000 + 80000 + 35000);
  });
});

describe("snapshots of quantity-based options", () => {
  it("record unit price, quantity and total; zero is left out", () => {
    const p = withChairs();
    const sel = { options: { ...table, chairs: "chairs-crossback" }, optionQuantities: { chairs: 6 }, addOns: {} };
    const s = buildConfigurationSnapshot(p, sel, priceConfiguration(p, sel), { priceShownToCustomer: true });
    const chairs = s.options.find((o) => o.groupId === "chairs")!;
    expect(chairs).toMatchObject({ valueDisplayName: "Cross Back Chair", priceModifierCents: 19250, quantity: 6, unitPriceCents: 19250, totalCents: 115500 });
    expect(snapshotOptionTotal(chairs)).toBe(115500);
    expect(snapshotOptionLabel(chairs)).toBe("Cross Back Chair × 6");
    expect(s.totalCents).toBe(120000 + 115500);
    // Ordinary options carry no quantity fields.
    expect(s.options.find((o) => o.groupId === "size")).not.toHaveProperty("quantity");

    const none = { ...sel, optionQuantities: { chairs: 0 } };
    expect(buildConfigurationSnapshot(p, none, priceConfiguration(p, none), { priceShownToCustomer: true }).options.map((o) => o.groupId)).toEqual(["size", "wood"]);
  });

  it("older snapshots (no quantity fields) read exactly as before", () => {
    const old: ConfigurationSnapshot["options"][number] = { groupId: "wood", groupName: "Wood", groupDisplayName: "Wood", valueId: "w", valueName: "Walnut", valueDisplayName: "Walnut", priceModifierCents: 80000, isCustom: false, customDetails: null };
    expect(snapshotOptionTotal(old)).toBe(80000);
    expect(snapshotOptionLabel(old)).toBe("Walnut");
  });
});
