import type { ProductConfigRecord } from "@/lib/pricing/resolve";

/** The Ridge Dining Table configuration from the brief, as database-shaped records. */
export function ridgeRecord(overrides: Partial<ProductConfigRecord> = {}): ProductConfigRecord {
  const g = (id: string, name: string, displayName: string, values: Array<[string, number, boolean?]>, inputType: "BUTTONS" | "IMAGE" | "SWATCH" = "BUTTONS") => ({
    id,
    name,
    displayName,
    description: null,
    inputType,
    required: true,
    active: true,
    values: values.map(([n, price, isCustom], i) => ({
      id: `${id}-${n.toLowerCase().replace(/\W+/g, "-")}`,
      name: n,
      displayName: n,
      description: null,
      priceModifierCents: price,
      isCustom: Boolean(isCustom),
      displayOrder: i,
      active: true,
      swatchColor: null,
      image: null,
    })),
  });
  const addOn = (id: string, name: string, price: number, extra: Partial<ProductConfigRecord["addOns"][number]["addOn"]> = {}) => ({
    enabled: true,
    priceOverrideCents: null,
    requiredOverride: null,
    minQuantityOverride: null,
    maxQuantityOverride: null,
    displayOrder: 0,
    addOn: { id, name, description: null, priceCents: price, required: false, minQuantity: 0, maxQuantity: 1, active: true, archivedAt: null, image: null, ...extra },
  });
  return {
    id: "ridge",
    name: "The Ridge Dining Table",
    slug: "ridge-dining-table",
    sku: "WM-RDT",
    basePriceCents: 120000,
    optionGroups: [
      { displayOrder: 0, requiredOverride: null, displayNameOverride: null, valueOverrides: [], optionGroup: g("size", "Dining Table Size", "Size", [["60", 0], ["72", 15000], ["84", 30000], ["96", 50000], ["Custom", 0, true]]) },
      { displayOrder: 1, requiredOverride: null, displayNameOverride: null, valueOverrides: [], optionGroup: g("wood", "Wood Species", "Wood", [["Pine", 0], ["Oak", 30000], ["Maple", 40000], ["Walnut", 80000]], "IMAGE") },
    ],
    addOns: [addOn("bench", "Matching Bench", 35000, { maxQuantity: 2 }), addOn("breadboard", "Breadboard Ends", 15000)],
    ...overrides,
  };
}
