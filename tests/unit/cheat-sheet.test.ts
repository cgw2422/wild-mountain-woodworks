import { describe, expect, it } from "vitest";
import { buildCheatSheet, guessAxes, priceCombination, resolveAxes } from "@/lib/pricing/cheat-sheet";
import { defaultSelection, priceConfiguration } from "@/lib/pricing/engine";
import { resolveConfigurableProduct, type ProductConfigRecord } from "@/lib/pricing/resolve";

type Values = ProductConfigRecord["optionGroups"][number]["optionGroup"]["values"];
const vid = (g: string, n: string) => `${g}-${n.toLowerCase().replace(/\W+/g, "-")}`;
function values(g: string, list: Array<[string, number, { custom?: boolean; inactive?: boolean; rules?: Array<[string, number]> }?]>): Values {
  return list.map(([n, price, o], i) => ({
    id: vid(g, n),
    name: n,
    displayName: n,
    description: null,
    priceModifierCents: price,
    isCustom: Boolean(o?.custom),
    displayOrder: i,
    active: !o?.inactive,
    swatchColor: null,
    image: null,
    priceRules: (o?.rules ?? []).map(([dep, cents], order) => ({ dependsOnValueId: dep, priceModifierCents: cents, displayOrder: order, dependsOnValue: { groupId: dep.split("-")[0]! } })),
  }));
}
const group = (id: string, name: string, vals: Values, order: number, required = true) => ({
  displayOrder: order,
  requiredOverride: null,
  displayNameOverride: null,
  valueOverrides: [] as ProductConfigRecord["optionGroups"][number]["valueOverrides"],
  optionGroup: { id, name, displayName: name, description: null, inputType: "BUTTONS" as const, required, active: true, values: vals },
});

/** A farmhouse table: Size, Table Top Wood Species, Base Material / Finish (Match Tabletop priced by the wood), Stain. */
function table(extra: Partial<ProductConfigRecord> = {}): ProductConfigRecord {
  return {
    id: "farm",
    name: "Farmhouse Table",
    slug: "farmhouse-table",
    sku: null,
    basePriceCents: 159900,
    optionGroups: [
      group("stain", "Stain", values("stain", [["Natural", 0], ["Ebony", 5000]]), 0),
      group("size", "Table Size", values("size", [["5' x 36\"", 0], ["6' x 36\"", 20000], ["7' x 36\"", 40000], ["8' x 36\"", 60000], ["Custom size", 0, { custom: true }]]), 1),
      group("wood", "Table Top Wood Species", values("wood", [["Pine", 0], ["Red Oak", 20000], ["Cherry", 50000, { inactive: true }], ["Walnut", 60000]]), 2),
      group(
        "base",
        "Base Material / Finish",
        values("base", [["Painted White", 0], ["Painted Black", 0], ["Match Tabletop", 0, { rules: [[vid("wood", "Red Oak"), 15000], [vid("wood", "Walnut"), 75000]] }]]),
        3,
      ),
    ],
    addOns: [],
    ...extra,
  };
}

describe("pricing cheat sheet", () => {
  it("finds the size, wood and base options by name and uses only current, active, listed values", () => {
    const p = resolveConfigurableProduct(table());
    expect(guessAxes(p)).toEqual({ rowGroupId: "size", columnGroupId: "wood", baseGroupId: "base" });
    const s = buildCheatSheet(p, guessAxes(p));
    expect(s.rows.map((r) => r.label)).toEqual(["5' x 36\"", "6' x 36\"", "7' x 36\"", "8' x 36\""]); // no "Custom size"
    expect(s.columns.map((c) => c.label)).toEqual(["Pine", "Red Oak", "Walnut"]); // inactive Cherry is gone
    expect(s.buckets.map((b) => b.label)).toEqual(["Painted White / Painted Black", "Match Tabletop"]);
    expect(s.fixed).toEqual([{ group: "Stain", value: "Natural" }]);
  });

  it("every cell is exactly what the product page's engine charges for that selection", () => {
    const p = resolveConfigurableProduct(table());
    const s = buildCheatSheet(p, guessAxes(p));
    for (const r of s.rows)
      for (const c of s.columns)
        for (const b of s.buckets)
          for (const valueId of b.valueIds) {
            const sel = defaultSelection(p);
            const priced = priceConfiguration(p, { ...sel, options: { ...sel.options, size: r.id, wood: c.id, base: valueId } });
            expect(s.cells[r.id]![c.id]![b.key]!.totalCents, `${r.label} ${c.label} ${valueId}`).toBe(priced.totalCents);
          }
    // "How much is a 6-foot Red Oak table with a matching base?" — core + 6' + Red Oak + Match (Red Oak rule).
    const six = s.rows[1]!.id;
    const redOak = vid("wood", "Red Oak");
    expect(s.cells[six]![redOak]![vid("base", "Match Tabletop")]).toEqual({ totalCents: 159900 + 20000 + 20000 + 15000, regularCents: 214900, savingsCents: 0 });
    expect(s.cells[six]![redOak]![vid("base", "Painted White")]!.totalCents).toBe(159900 + 20000 + 20000);
    // Walnut's matching base uses Walnut's conditional price.
    expect(s.cells[six]![vid("wood", "Walnut")]![vid("base", "Match Tabletop")]!.totalCents).toBe(159900 + 20000 + 60000 + 75000);
    // Pine has no rule → Match Tabletop at its default ($0).
    expect(s.cells[six]![vid("wood", "Pine")]![vid("base", "Match Tabletop")]!.totalCents).toBe(159900 + 20000);
  });

  it("shows regular and sale prices — the sale discounts only the core price", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const record = table({ saleEnabled: true, saleType: "PERCENT", salePercentBps: 3000, saleStartsAt: new Date("2026-10-01T00:00:00Z"), saleEndsAt: new Date("2026-11-01T00:00:00Z"), saleLabel: "Fall Sale" });
    const p = resolveConfigurableProduct(record, now);
    const s = buildCheatSheet(p, guessAxes(p));
    const cell = s.cells[s.rows[1]!.id]![vid("wood", "Red Oak")]![vid("base", "Match Tabletop")]!;
    const saleCore = p.basePriceCents!; // the engine's sale core price (rounded to the dollar, as on the site)
    expect(saleCore).toBeLessThan(159900);
    expect(cell).toEqual({ totalCents: saleCore + 20000 + 20000 + 15000, regularCents: 159900 + 20000 + 20000 + 15000, savingsCents: 159900 - saleCore });
    expect(s.sale).toMatchObject({ percent: 30, label: "Fall Sale" });
  });

  it("follows the product: species added, removed or switched off on the product appear/disappear", () => {
    const record = table();
    record.optionGroups[2]!.optionGroup.values.push(...values("wood", [["White Oak", 45000]]).map((v) => ({ ...v, displayOrder: 9 })));
    record.optionGroups[2]!.valueOverrides = [{ optionValueId: vid("wood", "Pine"), enabled: false, priceModifierOverrideCents: null, displayOrderOverride: null, isDefault: false }];
    const p = resolveConfigurableProduct(record);
    expect(buildCheatSheet(p, guessAxes(p)).columns.map((c) => c.label)).toEqual(["Red Oak", "Walnut", "White Oak"]);
  });

  it("lets you choose the axes, ignoring unknown ones, and works without a base or column option", () => {
    const p = resolveConfigurableProduct(table());
    expect(resolveAxes(p, { rowGroupId: "wood", columnGroupId: "size", baseGroupId: "none" })).toEqual({ rowGroupId: "wood", columnGroupId: "size", baseGroupId: null });
    expect(resolveAxes(p, { rowGroupId: "nope" })).toEqual(guessAxes(p));
    expect(resolveAxes(p, { rowGroupId: "size", columnGroupId: "size" }).columnGroupId).toBeNull();
    const noBase = buildCheatSheet(p, { rowGroupId: "size", columnGroupId: null, baseGroupId: null });
    expect(noBase.columns).toEqual([{ id: "_", label: "Price" }]);
    expect(noBase.buckets).toEqual([{ key: "_", label: "", valueIds: [] }]);
    // Base held at its default (Painted White).
    expect(noBase.cells[noBase.rows[0]!.id]!._!._!.totalCents).toBe(159900);
    expect(priceCombination(p, guessAxes(p), { row: vid("size", "Custom size") })).toBeNull(); // custom needs details → not priced
  });
});
