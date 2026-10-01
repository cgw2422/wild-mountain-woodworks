import { describe, expect, it } from "vitest";
import { addOnFieldKey, cheapestAddOnUnitPrice, configuredAddOnUnitPrice, defaultAddOnChoices, defaultSelection, priceConfiguration, startingPrice } from "@/lib/pricing/engine";
import { resolveConfigurableProduct, type ProductConfigRecord } from "@/lib/pricing/resolve";
import { addOnLineDetails, buildConfigurationSnapshot, parseAddOnLine } from "@/lib/pricing/snapshot";
import { ridgeRecord } from "../support/fixtures";

type GroupRecord = ProductConfigRecord["optionGroups"][number]["optionGroup"];
const value = (groupId: string, name: string, price: number, extra: Partial<GroupRecord["values"][number]> = {}) => ({
  id: `${groupId}-${name.toLowerCase().replace(/\W+/g, "-")}`,
  name,
  displayName: name,
  description: null,
  priceModifierCents: price,
  isCustom: false,
  displayOrder: 0,
  active: true,
  swatchColor: null,
  image: { url: `/img/${name}.jpg`, alt: "", width: 800, height: 600, focalX: 50, focalY: 50, blurDataUrl: null },
  ...extra,
});
const group = (id: string, displayName: string, values: GroupRecord["values"], extra: Partial<GroupRecord> = {}): GroupRecord => ({
  id,
  name: displayName,
  displayName,
  description: null,
  inputType: "IMAGE",
  required: true,
  active: true,
  values: values.map((v, i) => ({ ...v, displayOrder: i })),
  ...extra,
});

/** The Ridge table ($1,200) with "Add Dining Chairs": $192.50 base; X Back +$0 / Double X Back +$25; Pine/Oak +$20/Walnut +$60; finishes. */
function tableWithChairs(chairs: Partial<ProductConfigRecord["addOns"][number]["addOn"]> = {}) {
  const base = ridgeRecord();
  return resolveConfigurableProduct({
    ...base,
    addOns: [
      ...base.addOns,
      {
        enabled: true,
        priceOverrideCents: null,
        requiredOverride: null,
        minQuantityOverride: null,
        maxQuantityOverride: null,
        displayOrder: 2,
        addOn: {
          id: "chairs",
          name: "Dining Chairs",
          displayName: "Add Dining Chairs",
          description: "Add matching dining chairs to complete your table set.",
          priceCents: 19250,
          required: false,
          minQuantity: 2,
          maxQuantity: 12,
          quantityEnabled: true,
          quantityStep: 1,
          defaultQuantity: 4,
          active: true,
          archivedAt: null,
          image: null,
          optionGroups: [
            { displayOrder: 0, requiredOverride: null, displayNameOverride: "Choose Your Chair Style", optionGroup: group("style", "Chair Style", [value("style", "X Back", 0), value("style", "Double X Back", 2500), value("style", "Retired Style", 0, { active: false })]) },
            { displayOrder: 1, requiredOverride: null, displayNameOverride: null, optionGroup: group("wood", "Wood Species", [value("wood", "Pine", 0), value("wood", "Oak", 2000), value("wood", "Walnut", 6000), value("wood", "Custom species", 0, { isCustom: true })]) },
            { displayOrder: 2, requiredOverride: null, displayNameOverride: null, optionGroup: group("finish", "Chair Finish", [value("finish", "Natural", 0), value("finish", "Black", 1500)], { inputType: "SWATCH" }) },
            { displayOrder: 3, requiredOverride: null, displayNameOverride: null, optionGroup: group("seat", "Seat Finish", [value("seat", "Natural", 0), value("seat", "Special Walnut", 1000)], { inputType: "SWATCH" }) },
          ],
          ...chairs,
        },
      },
    ],
  });
}

const table = { size: "size-60", wood: "wood-pine" }; // $1,200 — the TABLE's own options
const chairChoices = { style: "style-x-back", wood: "wood-oak", finish: "finish-black", seat: "seat-special-walnut" };

describe("configurable add-ons (Dining Chairs)", () => {
  it("prices one configured chair (base + style + species + chair finish + seat finish), × quantity, added to the table", () => {
    const r = priceConfiguration(tableWithChairs(), { options: table, addOns: { chairs: 6 }, addOnOptions: { chairs: chairChoices } });
    expect(r.valid).toBe(true);
    const perChair = 19250 + 0 + 2000 + 1500 + 1000; // $237.50
    const line = r.lines.find((l) => l.kind === "addon")!;
    expect(line).toMatchObject({ label: "Add Dining Chairs", detail: "X Back · Oak · Black · Special Walnut", quantity: 6, unitCents: perChair, amountCents: perChair * 6 });
    expect(line.addOn!.choices.map((c) => [c.label, c.value, c.priceModifierCents])).toEqual([
      ["Choose Your Chair Style", "X Back", 0],
      ["Wood Species", "Oak", 2000],
      ["Chair Finish", "Black", 1500],
      ["Seat Finish", "Special Walnut", 1000],
    ]);
    expect(r.totalCents).toBe(120000 + perChair * 6);
  });

  it("the chair's wood species is independent of the table's wood species", () => {
    // Table in Pine (no charge), chairs in Walnut (+$60 each).
    const r = priceConfiguration(tableWithChairs(), { options: { size: "size-60", wood: "wood-pine" }, addOns: { chairs: 2 }, addOnOptions: { chairs: { ...chairChoices, wood: "wood-walnut" } } });
    expect(r.totalCents).toBe(120000 + 2 * (19250 + 6000 + 1500 + 1000));
  });

  it("No chairs (0) is allowed even with a 2-chair minimum; then the table is priced alone", () => {
    const r = priceConfiguration(tableWithChairs(), { options: table, addOns: { chairs: 0 }, addOnOptions: { chairs: chairChoices } });
    expect(r).toMatchObject({ valid: true, totalCents: 120000 });
    expect(r.lines.some((l) => l.kind === "addon")).toBe(false);
  });

  it("validates quantity (min, max, step) and every chair choice", () => {
    const p = tableWithChairs();
    expect(priceConfiguration(p, { options: table, addOns: { chairs: 1 }, addOnOptions: { chairs: chairChoices } }).errors.chairs).toMatch(/at least 2/);
    expect(priceConfiguration(p, { options: table, addOns: { chairs: 13 }, addOnOptions: { chairs: chairChoices } }).errors.chairs).toMatch(/between/);
    const pairs = tableWithChairs({ quantityStep: 2 });
    expect(priceConfiguration(pairs, { options: table, addOns: { chairs: 5 }, addOnOptions: { chairs: chairChoices } }).errors.chairs).toMatch(/steps of 2/);
    expect(priceConfiguration(pairs, { options: table, addOns: { chairs: 6 }, addOnOptions: { chairs: chairChoices } }).valid).toBe(true);

    const missing = priceConfiguration(p, { options: table, addOns: { chairs: 4 }, addOnOptions: { chairs: { style: "style-x-back" } } });
    expect(missing.valid).toBe(false);
    expect(missing.errors[addOnFieldKey("chairs", "wood")]).toMatch(/choose a wood species/i);
    expect(missing.errors.chairs).toMatch(/complete the add dining chairs choices/i);

    // A value from a different group, an inactive value, a custom value or an unknown group are all refused.
    for (const bad of [{ ...chairChoices, style: "wood-oak" }, { ...chairChoices, style: "style-retired-style" }, { ...chairChoices, wood: "wood-custom-species" }]) {
      expect(priceConfiguration(p, { options: table, addOns: { chairs: 4 }, addOnOptions: { chairs: bad } }).valid, JSON.stringify(bad)).toBe(false);
    }
    expect(priceConfiguration(p, { options: table, addOns: { chairs: 4 }, addOnOptions: { chairs: { ...chairChoices, hacker: "x" } } }).errors._form).toBeDefined();
    expect(priceConfiguration(p, { options: table, addOns: {}, addOnOptions: { ghost: { style: "x" } } }).errors._form).toBeDefined();
  });

  it("only active, non-custom values are offered; labels can be overridden per add-on", () => {
    const chairs = tableWithChairs().addOns.find((a) => a.id === "chairs")!;
    expect(chairs).toMatchObject({ name: "Add Dining Chairs", minQuantity: 2, maxQuantity: 12, quantityStep: 1, defaultQuantity: 4, quantityEnabled: true });
    expect(chairs.optionGroups.map((g) => g.displayName)).toEqual(["Choose Your Chair Style", "Wood Species", "Chair Finish", "Seat Finish"]);
    expect(chairs.optionGroups[0]!.values.map((v) => v.displayName)).toEqual(["X Back", "Double X Back"]);
    expect(chairs.optionGroups[1]!.values.map((v) => v.displayName)).toEqual(["Pine", "Oak", "Walnut"]);
    expect(chairs.optionGroups[0]!.values[0]!.image).toMatchObject({ url: "/img/X Back.jpg" });
    expect(defaultAddOnChoices(chairs)).toEqual({ style: "style-x-back", wood: "wood-pine", finish: "finish-natural", seat: "seat-natural" });
  });

  it("starts 'not added'; a required configurable add-on starts at its default with first choices", () => {
    expect(defaultSelection(tableWithChairs()).addOns.chairs).toBeUndefined();
    const req = tableWithChairs({ required: true });
    expect(defaultSelection(req)).toMatchObject({ addOns: { chairs: 4 }, addOnOptions: { chairs: { style: "style-x-back", wood: "wood-pine" } } });
    // "From" price includes the cheapest required configuration × minimum.
    expect(startingPrice(req)).toBe(120000 + 2 * 19250);
  });

  it("quantity off = a yes/no add-on fixed at 1", () => {
    const yesNo = tableWithChairs({ quantityEnabled: false, maxQuantity: 12 });
    const a = yesNo.addOns.find((x) => x.id === "chairs")!;
    expect(a).toMatchObject({ maxQuantity: 1, quantityEnabled: false });
    expect(priceConfiguration(yesNo, { options: table, addOns: { chairs: 2 }, addOnOptions: { chairs: chairChoices } }).valid).toBe(false);
    expect(priceConfiguration(yesNo, { options: table, addOns: { chairs: 1 }, addOnOptions: { chairs: chairChoices } }).totalCents).toBe(120000 + 23750);
  });

  it("simple add-ons and products without configurable add-ons price exactly as before", () => {
    const r = priceConfiguration(tableWithChairs(), { options: { size: "size-84", wood: "wood-walnut" }, addOns: { bench: 1 } });
    expect(r.totalCents).toBe(120000 + 30000 + 80000 + 35000);
    expect(resolveConfigurableProduct(ridgeRecord()).addOns.every((a) => a.optionGroups.length === 0 && a.quantityEnabled && a.quantityStep === 1)).toBe(true);
  });

  it("snapshots keep the add-on and its choices grouped, separate from the table's options", () => {
    const p = tableWithChairs();
    const sel = { options: table, addOns: { chairs: 6 }, addOnOptions: { chairs: chairChoices } };
    const s = buildConfigurationSnapshot(p, sel, priceConfiguration(p, sel), { priceShownToCustomer: true });
    expect(s.options.map((o) => o.groupId)).toEqual(["size", "wood"]); // the table only
    const chairs = s.addOns.find((a) => a.addOnId === "chairs")!;
    expect(chairs).toMatchObject({ name: "Add Dining Chairs", quantity: 6, basePriceCents: 19250, unitPriceCents: 23750, totalCents: 142500 });
    expect(chairs.choices!.map((c) => `${c.label}: ${c.value}`)).toEqual(["Choose Your Chair Style: X Back", "Wood Species: Oak", "Chair Finish: Black", "Seat Finish: Special Walnut"]);
    expect(chairs.choices![1]).toMatchObject({ groupId: "wood", valueId: "wood-oak" });
    const details = addOnLineDetails(s, chairs)!;
    expect(details).toMatchObject({ name: "Add Dining Chairs", parentProduct: { name: "The Ridge Dining Table" }, unitPriceCents: 23750 });
    expect(parseAddOnLine(JSON.parse(JSON.stringify(details)))).toEqual(details);
    expect(parseAddOnLine(null)).toBeNull();
    expect(parseAddOnLine({ junk: true })).toBeNull();
  });
});

describe("add-on unit price is computed once, quantity applied once (regression: $770 for 2 × $192.50)", () => {
  /** "X Back Farm Chair" $192.50 per chair on the style; wood/finishes have no extra cost. */
  function farmChairs(opts: { styleSetsPrice: boolean; base: number }) {
    const base = ridgeRecord();
    const free = (g: string, n: string) => value(g, n, 0);
    return resolveConfigurableProduct({
      ...base,
      addOns: [
        {
          enabled: true,
          priceOverrideCents: null,
          requiredOverride: null,
          minQuantityOverride: null,
          maxQuantityOverride: null,
          displayOrder: 0,
          addOn: {
            id: "chairs",
            name: "Dining Chairs",
            displayName: "Add Dining Chairs",
            description: null,
            priceCents: opts.base,
            required: false,
            minQuantity: 0,
            maxQuantity: 12,
            quantityEnabled: true,
            quantityStep: 1,
            defaultQuantity: 2,
            active: true,
            archivedAt: null,
            image: null,
            optionGroups: [
              { displayOrder: 0, requiredOverride: null, displayNameOverride: null, setsUnitPrice: opts.styleSetsPrice, optionGroup: group("style", "Chair Style", [value("style", "X Back Farm Chair", 19250), value("style", "Double X Back", 21750)]) },
              { displayOrder: 1, requiredOverride: null, displayNameOverride: null, optionGroup: group("wood", "Wood Species", [free("wood", "Pine")]) },
              { displayOrder: 2, requiredOverride: null, displayNameOverride: null, optionGroup: group("finish", "Chair Finish", [free("finish", "Natural")]) },
              { displayOrder: 3, requiredOverride: null, displayNameOverride: null, optionGroup: group("seat", "Seat Finish", [free("seat", "Natural")]) },
            ],
          },
        },
      ],
    });
  }
  const pick = { style: "style-x-back-farm-chair", wood: "wood-pine", finish: "finish-natural", seat: "seat-natural" };
  const chairsLine = (p: ReturnType<typeof farmChairs>, qty: number) =>
    priceConfiguration(p, { options: table, addOns: { chairs: qty }, addOnOptions: { chairs: pick } }).lines.find((l) => l.kind === "addon")!;

  it("style sets the per-chair price: 2 × $192.50 = $385 (the add-on base is not added)", () => {
    // Even with the same $192.50 also typed into the add-on's base price, nothing is counted twice.
    for (const baseCents of [0, 19250]) {
      const p = farmChairs({ styleSetsPrice: true, base: baseCents });
      const line = chairsLine(p, 2);
      expect(line, `base ${baseCents}`).toMatchObject({ quantity: 2, unitCents: 19250, amountCents: 38500 });
      expect(line.addOn).toMatchObject({ basePriceCents: 19250 });
      expect(configuredAddOnUnitPrice(p.addOns[0]!, pick).unitCents).toBe(19250);
      expect(priceConfiguration(p, { options: table, addOns: { chairs: 2 }, addOnOptions: { chairs: pick } }).totalCents).toBe(120000 + 38500);
    }
    // Every quantity is exactly unit × quantity.
    const p = farmChairs({ styleSetsPrice: true, base: 19250 });
    for (const q of [1, 2, 3, 6, 12]) expect(chairsLine(p, q).amountCents).toBe(19250 * q);
    // Adjustments are added once per chair, never multiplied separately.
    const oak = { ...p, addOns: p.addOns.map((a) => ({ ...a, optionGroups: a.optionGroups.map((g) => (g.id === "wood" ? { ...g, values: [{ ...g.values[0]!, priceModifierCents: 2000 }] } : g)) })) };
    expect(chairsLine(oak, 2)).toMatchObject({ unitCents: 21250, amountCents: 42500 });
    // "From" price and the Double X Back price.
    expect(cheapestAddOnUnitPrice(p.addOns[0]!)).toBe(19250);
    expect(configuredAddOnUnitPrice(p.addOns[0]!, { ...pick, style: "style-double-x-back" }).unitCents).toBe(21750);
  });

  it("adjustment model: base $192.50 + style $0 → 2 × $192.50 = $385", () => {
    const p = farmChairs({ styleSetsPrice: false, base: 19250 });
    const zeroStyle = { ...p, addOns: p.addOns.map((a) => ({ ...a, optionGroups: a.optionGroups.map((g) => (g.id === "style" ? { ...g, values: g.values.map((v) => ({ ...v, priceModifierCents: 0 })) } : g)) })) };
    expect(chairsLine(zeroStyle, 2)).toMatchObject({ unitCents: 19250, amountCents: 38500 });
  });

  it("the $770 case is a price entered twice (base + a full style price as an adjustment), not a quantity applied twice", () => {
    const p = farmChairs({ styleSetsPrice: false, base: 19250 });
    // $192.50 base + $192.50 "adjustment" = $385 per chair; × 2 = $770. Quantity is still applied once.
    expect(chairsLine(p, 2)).toMatchObject({ unitCents: 38500, amountCents: 77000 });
    expect(chairsLine(p, 1)).toMatchObject({ unitCents: 38500, amountCents: 38500 });
  });

  it("the price is per individual chair, whatever the quantity step or default", () => {
    const base = farmChairs({ styleSetsPrice: true, base: 0 });
    const pairs = { ...base, addOns: base.addOns.map((a) => ({ ...a, quantityStep: 2, defaultQuantity: 4 })) };
    expect(chairsLine(pairs, 2)).toMatchObject({ unitCents: 19250, amountCents: 38500 });
    expect(chairsLine(pairs, 4)).toMatchObject({ unitCents: 19250, amountCents: 77000 });
  });
});
