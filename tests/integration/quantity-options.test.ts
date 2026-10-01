import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest } = await import("../support/next-request");
const actions = await import("@/app/admin/(panel)/options/actions");
const { createConfigurationQuote } = await import("@/lib/services/submissions");
const { loadConfigurableProduct } = await import("@/lib/pricing/load");
const { parseSnapshot } = await import("@/lib/pricing/snapshot");
const { describeSnapshot } = await import("@/lib/email/notifications");
const { configurationQuoteSchema } = await import("@/lib/validation/forms");
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe.skipIf(!hasTestDb)("quantity-based option values", () => {
  let seeded: Awaited<ReturnType<typeof seedRidge>>;
  let chairs: { id: string };

  beforeEach(async () => {
    await resetDb();
    resetRequest();
    await prisma.siteSetting.create({ data: { id: "default" } });
    await createSignedInAdmin();
    seeded = await seedRidge();
    chairs = await prisma.optionGroup.create({ data: { name: "Dining Chairs", displayName: "Add Dining Chairs", inputType: "RADIO", required: false } });
    await prisma.productOptionGroup.create({ data: { productId: seeded.product.id, optionGroupId: chairs.id, displayOrder: 2 } });
  });

  const chairForm = (extra: Record<string, string> = {}) =>
    form({ displayName: "Cross Back Chair", priceModifier: "192.50", active: "on", quantityEnabled: "on", quantityMin: "0", quantityMax: "8", quantityStep: "1", quantityDefault: "0", ...extra });

  it("admin sets a value as quantity-based with price per unit, min, max, step and default", async () => {
    const res = await actions.saveOptionValue(chairs.id, null, chairForm());
    expect(res).toMatchObject({ ok: true });
    const v = await prisma.optionValue.findUniqueOrThrow({ where: { id: res.id! } });
    expect(v).toMatchObject({ displayName: "Cross Back Chair", priceModifierCents: 19250, quantityEnabled: true, quantityMin: 0, quantityMax: 8, quantityStep: 1, quantityDefault: 0 });

    // Bad ranges are refused with field errors.
    for (const [bad, field] of [
      [{ quantityMax: "0" }, "quantityMax"],
      [{ quantityMin: "4", quantityMax: "2" }, "quantityMax"],
      [{ quantityStep: "0" }, "quantityStep"],
      [{ quantityDefault: "9" }, "quantityDefault"],
      [{ quantityMin: "2", quantityStep: "2", quantityDefault: "3" }, "quantityDefault"],
      [{ quantityMax: "-1" }, "quantityMax"],
      [{ quantityMax: "abc" }, "quantityMax"],
    ] as const) {
      const r = await actions.saveOptionValue(chairs.id, v.id, chairForm(bad));
      expect(r, JSON.stringify(bad)).toMatchObject({ ok: false, fieldErrors: { [field]: expect.any(String) } });
    }
    expect(await prisma.optionValue.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({ quantityMax: 8, quantityDefault: 0 });

    // Turning quantity off makes it an ordinary value again (the range is kept for later).
    await actions.saveOptionValue(chairs.id, v.id, form({ displayName: "Cross Back Chair", priceModifier: "192.50", active: "on" }));
    expect(await prisma.optionValue.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({ quantityEnabled: false, quantityMax: 8 });
  });

  it("a quote request for the table with 4 chairs is priced price × quantity and gets its own quote line", async () => {
    const { id } = (await actions.saveOptionValue(chairs.id, null, chairForm())) as { id: string };
    const product = (await loadConfigurableProduct({ id: seeded.product.id }))!;
    const group = product.optionGroups.find((g) => g.id === chairs.id)!;
    expect(group.values[0]).toMatchObject({ priceModifierCents: 19250, quantity: { min: 0, max: 8, step: 1, default: 0 } });

    // The submitted JSON (as the configurator sends it) passes the server schema.
    const parsed = configurationQuoteSchema.shape.selection.parse(
      JSON.stringify({ options: { [seeded.ids.size]: seeded.ids.s60, [seeded.ids.wood]: seeded.ids.pine, [chairs.id]: id }, optionQuantities: { [chairs.id]: 4 }, addOns: {} }),
    );
    expect(parsed.optionQuantities).toEqual({ [chairs.id]: 4 });

    const quote = await createConfigurationQuote({ name: "Jamie Rivers", email: "jamie@example.com", phone: null, zipCode: "43215", timeline: null, notes: null, productId: seeded.product.id, selection: parsed });
    const q = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, include: { currentRevision: { include: { lineItems: { orderBy: { position: "asc" } } } } } });
    const snap = parseSnapshot(q.configuration)!;
    expect(snap.totalCents).toBe(120000 + 4 * 19250);
    expect(q.estimatedTotalCents).toBe(197000);
    expect(snap.options.find((o) => o.groupId === chairs.id)).toMatchObject({ valueDisplayName: "Cross Back Chair", quantity: 4, unitPriceCents: 19250, totalCents: 77000 });

    // Draft quote: the table line + "Add Dining Chairs — Cross Back Chair" 4 × $192.50; totals match the snapshot.
    const lines = q.currentRevision!.lineItems;
    expect(lines.map((l) => [l.kind, l.description, l.quantity, l.unitPriceCents, l.lineTotalCents])).toEqual([
      ["PRODUCT", "The Ridge Dining Table", 1, 120000, 120000],
      ["ADDON", "Add Dining Chairs — Cross Back Chair", 4, 19250, 77000],
    ]);
    expect(q.currentRevision!.totalCents).toBe(197000);
    expect(describeSnapshot(snap, true)).toContain("Add Dining Chairs: Cross Back Chair × 4");
  });

  it("0 chairs: the table alone, nothing about chairs on the quote", async () => {
    const { id } = (await actions.saveOptionValue(chairs.id, null, chairForm())) as { id: string };
    const quote = await createConfigurationQuote({
      name: "Jamie Rivers",
      email: "jamie@example.com",
      phone: null,
      zipCode: "43215",
      timeline: null,
      notes: null,
      productId: seeded.product.id,
      selection: { options: { [seeded.ids.size]: seeded.ids.s60, [seeded.ids.wood]: seeded.ids.pine, [chairs.id]: id }, optionQuantities: { [chairs.id]: 0 }, addOns: {}, customDetails: {} },
    });
    const q = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, include: { currentRevision: { include: { lineItems: true } } } });
    expect(q.estimatedTotalCents).toBe(120000);
    expect(q.currentRevision!.lineItems.map((l) => l.description)).toEqual(["The Ridge Dining Table"]);
  });

  it("the server refuses a quantity outside the allowed range", async () => {
    const { id } = (await actions.saveOptionValue(chairs.id, null, chairForm())) as { id: string };
    await expect(
      createConfigurationQuote({
        name: "Jamie Rivers",
        email: "jamie@example.com",
        phone: null,
        zipCode: "43215",
        timeline: null,
        notes: null,
        productId: seeded.product.id,
        selection: { options: { [seeded.ids.size]: seeded.ids.s60, [seeded.ids.wood]: seeded.ids.pine, [chairs.id]: id }, optionQuantities: { [chairs.id]: 12 }, addOns: {}, customDetails: {} },
      }),
    ).rejects.toMatchObject({ fieldErrors: { [chairs.id]: expect.stringMatching(/between 0 and 8/) } });
    expect(await prisma.quoteRequest.count()).toBe(0);
  });

  it("a per-product price override applies per unit", async () => {
    const { id } = (await actions.saveOptionValue(chairs.id, null, chairForm())) as { id: string };
    const pog = await prisma.productOptionGroup.findFirstOrThrow({ where: { optionGroupId: chairs.id } });
    await prisma.productOptionValue.create({ data: { productOptionGroupId: pog.id, optionValueId: id, priceModifierOverrideCents: 17500 } });
    const product = (await loadConfigurableProduct({ id: seeded.product.id }))!;
    const { priceConfiguration } = await import("@/lib/pricing/engine");
    expect(priceConfiguration(product, { options: { [seeded.ids.size]: seeded.ids.s60, [seeded.ids.wood]: seeded.ids.pine, [chairs.id]: id }, optionQuantities: { [chairs.id]: 6 }, addOns: {} }).totalCents).toBe(120000 + 6 * 17500);
  });

  it("existing values and saved quotes are untouched: values default to non-quantity, old snapshots still read", async () => {
    // Every pre-existing value (seeded the old way, no quantity fields) stays an ordinary value.
    const values = await prisma.optionValue.findMany();
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => v.quantityEnabled === false)).toBe(true);
    const product = (await loadConfigurableProduct({ id: seeded.product.id }))!;
    expect(product.optionGroups.flatMap((g) => g.values).every((v) => v.quantity === null)).toBe(true);

    // A quote saved before this change (snapshot without quantity fields) is shown and re-read unchanged.
    const old = { version: 1, capturedAt: "2026-09-01T00:00:00.000Z", currency: "usd", product: { id: seeded.product.id, name: "The Ridge Dining Table", slug: "ridge-dining-table", sku: "WM-RDT" }, basePriceCents: 120000, options: [{ groupId: seeded.ids.wood, groupName: "Wood Species", groupDisplayName: "Wood", valueId: seeded.ids.walnut, valueName: "Walnut", valueDisplayName: "Walnut", priceModifierCents: 60000, isCustom: false, customDetails: null }], addOns: [], totalCents: 180000, requiresCustomQuote: false, priceShownToCustomer: true };
    const saved = await prisma.quoteRequest.create({ data: { reference: "WM-Q-260901-ABCD", number: "WMQ-1001", name: "Pat", email: "pat@example.com", zipCode: "43215", configuration: old } });
    const snap = parseSnapshot((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: saved.id } })).configuration)!;
    expect(snap).toEqual(old);
    expect(describeSnapshot(snap, true)).toEqual(["Piece: The Ridge Dining Table", "Wood: Walnut", "Estimated price: $1,800"]);
  });

  it("duplicating a group or value keeps its quantity settings", async () => {
    const { id } = (await actions.saveOptionValue(chairs.id, null, chairForm({ quantityMin: "2", quantityMax: "8", quantityStep: "2", quantityDefault: "4" }))) as { id: string };
    const dupValue = await actions.duplicateOptionValue(chairs.id, id);
    expect(await prisma.optionValue.findUniqueOrThrow({ where: { id: dupValue.id! } })).toMatchObject({ quantityEnabled: true, quantityMin: 2, quantityMax: 8, quantityStep: 2, quantityDefault: 4 });
    const dupGroup = await actions.duplicateOptionGroup(chairs.id);
    const copied = await prisma.optionValue.findFirstOrThrow({ where: { groupId: dupGroup.id!, name: "Cross Back Chair" } });
    expect(copied).toMatchObject({ quantityEnabled: true, quantityMin: 2, quantityMax: 8, quantityStep: 2, quantityDefault: 4, priceModifierCents: 19250 });
  });

  it("the database refuses an impossible range even outside the admin form", async () => {
    await expect(prisma.optionValue.create({ data: { groupId: chairs.id, name: "Bad", displayName: "Bad", quantityEnabled: true, quantityMin: 5, quantityMax: 2 } })).rejects.toThrow();
  });
});
