import { describe, expect, it } from "vitest";
import { applyConditionalPrices, cheapestAddOnUnitPrice, configuredAddOnUnitPrice, optionValuePrice, priceConfiguration, startingPrice } from "@/lib/pricing/engine";
import { resolveConfigurableProduct, type ProductConfigRecord } from "@/lib/pricing/resolve";
import { buildConfigurationSnapshot, parseSnapshot } from "@/lib/pricing/snapshot";

type Values = ProductConfigRecord["optionGroups"][number]["optionGroup"]["values"];

const id = (group: string, name: string) => `${group}-${name.toLowerCase().replace(/\W+/g, "-")}`;

function values(group: string, list: Array<[string, number, Array<[string, number]>?]>, extra: Partial<Values[number]> = {}): Values {
  return list.map(([name, price, rules], i) => ({
    id: id(group, name),
    name,
    displayName: name,
    description: null,
    priceModifierCents: price,
    isCustom: false,
    displayOrder: i,
    active: true,
    swatchColor: null,
    image: null,
    // Rules: [controlling value id, price] — the controlling value's group is read from its id prefix.
    priceRules: (rules ?? []).map(([dependsOnValueId, cents], order) => ({ dependsOnValueId, priceModifierCents: cents, displayOrder: order, dependsOnValue: { groupId: dependsOnValueId.split("-")[0]! } })),
    ...extra,
  }));
}

const group = (gid: string, name: string, vals: Values, required = true) => ({
  displayOrder: 0,
  requiredOverride: null,
  displayNameOverride: null,
  valueOverrides: [] as ProductConfigRecord["optionGroups"][number]["valueOverrides"],
  optionGroup: { id: gid, name, displayName: name, description: null, inputType: "BUTTONS" as const, required, active: true, values: vals },
});

const MATCH_RULES: Array<[string, number]> = [
  [id("top", "Red Oak"), 15000],
  [id("top", "Maple"), 30000],
  [id("top", "White Oak"), 60000],
  [id("top", "Walnut"), 75000],
];

/** A farmhouse table: Table Top Wood, then Base Material / Finish where "Match Tabletop" is priced by the top wood. */
function farmTable(extra: Partial<ProductConfigRecord> = {}): ProductConfigRecord {
  return {
    id: "farm",
    name: "Farmhouse Table",
    slug: "farmhouse-table",
    sku: null,
    basePriceCents: 159900,
    optionGroups: [
      { ...group("top", "Table Top Wood Options", values("top", [["Pine", 0], ["Red Oak", 20000], ["Maple", 30000], ["White Oak", 45000], ["Walnut", 60000]])), displayOrder: 0 },
      { ...group("base", "Base Material / Finish", values("base", [["Painted White", 0], ["Painted Black", 0], ["Match Tabletop", 0, MATCH_RULES]])), displayOrder: 1 },
    ],
    addOns: [],
    ...extra,
  };
}

const pick = (top: string, base: string) => ({ options: { top: id("top", top), base: id("base", base) }, addOns: {} });
const optionLine = (r: ReturnType<typeof priceConfiguration>, label: string) => r.lines.find((l) => l.kind === "option" && l.label === label);

describe("conditional option pricing", () => {
  it("prices Match Tabletop by the selected tabletop wood; painted bases stay $0", () => {
    const p = resolveConfigurableProduct(farmTable());
    const expected: Record<string, number> = { Pine: 0, "Red Oak": 15000, Maple: 30000, "White Oak": 60000, Walnut: 75000 };
    for (const [wood, cents] of Object.entries(expected)) {
      const r = priceConfiguration(p, pick(wood, "Match Tabletop"));
      expect(r.valid).toBe(true);
      expect(optionLine(r, "Base Material / Finish"), wood).toMatchObject({ detail: "Match Tabletop", unitCents: cents, amountCents: cents });
      const topCents = optionLine(r, "Table Top Wood Options")!.amountCents;
      expect(r.totalCents, wood).toBe(159900 + topCents + cents);
      for (const painted of ["Painted White", "Painted Black"]) expect(optionLine(priceConfiguration(p, pick(wood, painted)), "Base Material / Finish")!.amountCents).toBe(0);
    }
    // The line records which rule set the price; default-priced lines don't.
    expect(optionLine(priceConfiguration(p, pick("Walnut", "Match Tabletop")), "Base Material / Finish")!.conditional).toEqual({ dependsOnGroupId: "top", dependsOnValueId: id("top", "Walnut"), priceModifierCents: 75000 });
    expect(optionLine(priceConfiguration(p, pick("Pine", "Match Tabletop")), "Base Material / Finish")!.conditional).toBeUndefined();
  });

  it("the price shown beside each value is the conditional price for the current choices, and updates when the controlling choice changes", () => {
    const p = resolveConfigurableProduct(farmTable());
    const shownBase = (sel: { options: Record<string, string> }) =>
      Object.fromEntries(applyConditionalPrices(p, sel).optionGroups.find((g) => g.id === "base")!.values.map((v) => [v.displayName, v.priceModifierCents]));
    expect(shownBase(pick("Red Oak", "Match Tabletop"))).toEqual({ "Painted White": 0, "Painted Black": 0, "Match Tabletop": 15000 });
    expect(shownBase(pick("Walnut", "Match Tabletop"))).toEqual({ "Painted White": 0, "Painted Black": 0, "Match Tabletop": 75000 });
    // Before a wood is chosen (or with a painted base selected), the value still shows its current price.
    expect(shownBase({ options: {} })["Match Tabletop"]).toBe(0);
    expect(shownBase(pick("Maple", "Painted White"))["Match Tabletop"]).toBe(30000);
    // Applying twice changes nothing (the default is kept aside), and products without rules are returned as-is.
    const once = applyConditionalPrices(p, pick("Walnut", "Match Tabletop"));
    expect(applyConditionalPrices(once, pick("Red Oak", "Match Tabletop")).optionGroups[1]!.values[2]!.priceModifierCents).toBe(15000);
    const plain = resolveConfigurableProduct(farmTable({ optionGroups: [group("top", "Top", values("top", [["Pine", 0]]))] }));
    expect(applyConditionalPrices(plain, { options: {} })).toBe(plain);
  });

  it("applies a product sale to the core price only — option prices, conditional or not, are added after", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const record = farmTable({ saleEnabled: true, saleType: "PERCENT", salePercentBps: 3000, salePriceCents: null, saleStartsAt: new Date("2026-10-01T00:00:00Z"), saleEndsAt: new Date("2026-11-01T00:00:00Z"), saleLabel: null });
    const p = resolveConfigurableProduct(record, now);
    // $1,599 × 70% = $1,119.30, rounded to the whole dollar like every percent sale (src/lib/pricing/sale.ts).
    expect(p.basePriceCents).toBe(111900);
    const r = priceConfiguration(p, pick("Red Oak", "Match Tabletop"));
    expect(r.totalCents).toBe(111900 + 20000 + 15000); // sale core + $200 + $150 — never ($1,599 + $350) × 70%
    expect(r.totalCents).not.toBe(Math.round((159900 + 35000) * 0.7));
    expect(r.savingsCents).toBe(159900 - 111900); // only the core price is discounted
  });

  it("uses the default when no rule matches; a product price override is the default, and a matching rule still wins", () => {
    const record = farmTable();
    record.optionGroups[1]!.valueOverrides = [{ optionValueId: id("base", "Match Tabletop"), enabled: true, priceModifierOverrideCents: 5000, displayOrderOverride: null, isDefault: false }];
    const p = resolveConfigurableProduct(record);
    expect(optionLine(priceConfiguration(p, pick("Pine", "Match Tabletop")), "Base Material / Finish")!.amountCents).toBe(5000);
    expect(optionLine(priceConfiguration(p, pick("Maple", "Match Tabletop")), "Base Material / Finish")!.amountCents).toBe(30000);
  });

  it("the first matching rule wins when rules depend on different options", () => {
    const record = farmTable();
    record.optionGroups.push({ ...group("size", "Size", values("size", [["60", 0], ["96", 50000]])), displayOrder: 2 });
    const match = record.optionGroups[1]!.optionGroup.values[2]!;
    match.priceRules = [
      { dependsOnValueId: id("size", "96"), priceModifierCents: 99900, displayOrder: 0, dependsOnValue: { groupId: "size" } },
      ...match.priceRules!.map((r) => ({ ...r, displayOrder: r.displayOrder + 1 })),
    ];
    const p = resolveConfigurableProduct(record);
    const sel = (size: string) => ({ options: { top: id("top", "Walnut"), base: id("base", "Match Tabletop"), size: id("size", size) }, addOns: {} });
    expect(optionLine(priceConfiguration(p, sel("96")), "Base Material / Finish")!.amountCents).toBe(99900);
    expect(optionLine(priceConfiguration(p, sel("60")), "Base Material / Finish")!.amountCents).toBe(75000);
    const v = p.optionGroups[1]!.values[2]!;
    expect(optionValuePrice(v, { top: id("top", "Walnut") }).priceModifierCents).toBe(75000);
    expect(optionValuePrice(v, {}).rule).toBeNull();
  });

  it("works for quantity-based values: the rule sets the price per unit, × quantity once", () => {
    const record = farmTable();
    record.optionGroups.push({
      ...group(
        "chairs",
        "Add Dining Chairs",
        values("chairs", [["Cross Back Chair", 19250, [[id("top", "Walnut"), 24900]]]], { quantityEnabled: true, quantityMin: 0, quantityMax: 8, quantityStep: 1, quantityDefault: 0 }),
        false,
      ),
      displayOrder: 2,
    });
    const p = resolveConfigurableProduct(record);
    const sel = (wood: string) => ({ options: { top: id("top", wood), base: id("base", "Painted White"), chairs: id("chairs", "Cross Back Chair") }, optionQuantities: { chairs: 4 }, addOns: {} });
    expect(optionLine(priceConfiguration(p, sel("Pine")), "Add Dining Chairs")).toMatchObject({ quantity: 4, unitCents: 19250, amountCents: 77000 });
    expect(optionLine(priceConfiguration(p, sel("Walnut")), "Add Dining Chairs")).toMatchObject({ quantity: 4, unitCents: 24900, amountCents: 99600 });
  });

  it("works inside configurable add-ons, depending on the add-on's own choices or the main product's options", () => {
    const addOnGroup = (gid: string, name: string, vals: Values, setsUnitPrice = false) => ({ displayOrder: 0, requiredOverride: null, displayNameOverride: null, setsUnitPrice, optionGroup: group(gid, name, vals).optionGroup });
    const record = farmTable({
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
            description: null,
            priceCents: 0,
            required: false,
            minQuantity: 0,
            maxQuantity: 8,
            active: true,
            archivedAt: null,
            image: null,
            optionGroups: [
              { ...addOnGroup("style", "Chair Style", values("style", [["X Back", 19250], ["Double X Back", 21750]]), true), displayOrder: 0 },
              // Chair finish "Match Table" is priced by the TABLE's top wood (a main-product option).
              { ...addOnGroup("cfinish", "Chair Finish", values("cfinish", [["Black", 0], ["Match Table", 1000, [[id("top", "Walnut"), 4000]]]])), displayOrder: 1 },
              // Cushion price depends on the chair style chosen inside the add-on.
              { ...addOnGroup("cushion", "Cushion", values("cushion", [["Linen", 2500, [[id("style", "Double X Back"), 3500]]]])), displayOrder: 2 },
            ],
          },
        },
      ],
    });
    const p = resolveConfigurableProduct(record);
    const chairs = p.addOns[0]!;
    const picks = (style: string, finish: string) => ({ style: id("style", style), cfinish: id("cfinish", finish), cushion: id("cushion", "Linen") });
    expect(configuredAddOnUnitPrice(chairs, picks("X Back", "Match Table"), { top: id("top", "Pine") }).unitCents).toBe(19250 + 1000 + 2500);
    expect(configuredAddOnUnitPrice(chairs, picks("X Back", "Match Table"), { top: id("top", "Walnut") }).unitCents).toBe(19250 + 4000 + 2500);
    expect(configuredAddOnUnitPrice(chairs, picks("Double X Back", "Black"), {}).unitCents).toBe(21750 + 0 + 3500);
    // Through the whole engine: 2 chairs, × quantity once.
    const sel = { ...pick("Walnut", "Painted White"), addOns: { chairs: 2 }, addOnOptions: { chairs: picks("Double X Back", "Match Table") } };
    const r = priceConfiguration(p, sel);
    const line = r.lines.find((l) => l.kind === "addon")!;
    expect(line).toMatchObject({ quantity: 2, unitCents: 21750 + 4000 + 3500, amountCents: 2 * (21750 + 4000 + 3500) });
    expect(line.addOn!.choices.map((c) => [c.value, c.priceModifierCents, Boolean(c.conditional)])).toEqual([
      ["Double X Back", 21750, false],
      ["Match Table", 4000, true],
      ["Linen", 3500, true],
    ]);
    // What the configurator shows inside the add-on panel matches.
    const shown = applyConditionalPrices(p, sel).addOns[0]!.optionGroups;
    expect(shown.find((g) => g.id === "cfinish")!.values.find((v) => v.displayName === "Match Table")!.priceModifierCents).toBe(4000);
    // "From": X Back + Black + Linen (cushion is required) = $217.50.
    expect(cheapestAddOnUnitPrice(chairs)).toBe(19250 + 0 + 2500);
  });

  it("'From' prices are an achievable combination with conditional prices in effect", () => {
    const p = resolveConfigurableProduct(farmTable());
    expect(startingPrice(p)).toBe(159900); // Pine + a $0 base
    // Make every base cost money except "Match Tabletop" on Pine: From = Pine + Match Tabletop ($0).
    const record = farmTable();
    record.optionGroups[1]!.optionGroup.values = values("base", [["Painted White", 20000], ["Match Tabletop", 50000, [[id("top", "Pine"), 0]]]]);
    expect(startingPrice(resolveConfigurableProduct(record))).toBe(159900);
    const r = priceConfiguration(resolveConfigurableProduct(record), pick("Pine", "Match Tabletop"));
    expect(r.totalCents).toBe(159900);
  });

  it("snapshots keep the conditional price and why, so saved quotes never change", () => {
    const p = resolveConfigurableProduct(farmTable());
    const sel = pick("Walnut", "Match Tabletop");
    const s = buildConfigurationSnapshot(p, sel, priceConfiguration(p, sel), { priceShownToCustomer: true });
    expect(s.totalCents).toBe(159900 + 60000 + 75000);
    expect(s.options.find((o) => o.groupId === "base")).toMatchObject({
      valueDisplayName: "Match Tabletop",
      priceModifierCents: 75000,
      priceCondition: { dependsOnGroupId: "top", dependsOnGroupName: "Table Top Wood Options", dependsOnValueName: "Walnut", defaultPriceModifierCents: 0 },
    });
    expect(s.options.find((o) => o.groupId === "top")).not.toHaveProperty("priceCondition");
    // A snapshot taken before conditional pricing (no priceCondition) reads exactly as before.
    const old = JSON.parse(JSON.stringify(s));
    delete old.options[1].priceCondition;
    expect(parseSnapshot(old)!.options[1]!.priceModifierCents).toBe(75000);
  });
});
