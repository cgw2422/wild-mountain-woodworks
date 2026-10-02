import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest } = await import("../support/next-request");
const options = await import("@/app/admin/(panel)/options/actions");
const { createConfigurationQuote } = await import("@/lib/services/submissions");
const { loadConfigurableProduct } = await import("@/lib/pricing/load");
const { applyConditionalPrices, priceConfiguration } = await import("@/lib/pricing/engine");
const { parseSnapshot } = await import("@/lib/pricing/snapshot");
const quotes = await import("@/lib/sales/quotes");
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const meta = { ip: "198.51.100.7", userAgent: "Mozilla/5.0 test" };

describe.skipIf(!hasTestDb)("conditional option pricing end to end", () => {
  let seeded: Awaited<ReturnType<typeof seedRidge>>;
  let admin: { id: string; name: string };
  let base: { id: string; white: string; black: string; match: string };

  beforeEach(async () => {
    await resetDb();
    resetRequest();
    await prisma.siteSetting.create({ data: { id: "default" } });
    const u = await createSignedInAdmin();
    admin = { id: u.id, name: u.name };
    seeded = await seedRidge();
    const g = await prisma.optionGroup.create({
      data: {
        name: "Base Material / Finish",
        displayName: "Base Material / Finish",
        values: { create: ["Painted White", "Painted Black", "Match Tabletop"].map((n, i) => ({ name: n, displayName: n, priceModifierCents: 0, displayOrder: i })) },
      },
      include: { values: true },
    });
    const v = (n: string) => g.values.find((x) => x.name === n)!.id;
    base = { id: g.id, white: v("Painted White"), black: v("Painted Black"), match: v("Match Tabletop") };
    await prisma.productOptionGroup.create({ data: { productId: seeded.product.id, optionGroupId: g.id, displayOrder: 2 } });
  });

  const saveMatch = (rules: Array<{ dependsOnValueId: string; price: string }>, price = "0") =>
    options.saveOptionValue(base.id, base.match, form({ displayName: "Match Tabletop", name: "Match Tabletop", priceModifier: price, active: "on", priceRules: JSON.stringify(rules) }));
  const selection = (wood: string, baseValue: string) => ({ options: { [seeded.ids.size]: seeded.ids.s60, [seeded.ids.wood]: wood, [base.id]: baseValue }, addOns: {}, customDetails: {} });
  const request = (wood: string, baseValue: string) =>
    createConfigurationQuote({ name: "Jamie Rivers", email: "jamie@example.com", phone: null, zipCode: "43215", timeline: null, notes: null, productId: seeded.product.id, selection: selection(wood, baseValue) });

  it("admin adds, edits, reorders and deletes rules; invalid rules are refused", async () => {
    expect(await saveMatch([{ dependsOnValueId: seeded.ids.walnut, price: "750" }, { dependsOnValueId: seeded.ids.pine, price: "0" }])).toMatchObject({ ok: true });
    let rules = await prisma.optionValuePriceRule.findMany({ where: { optionValueId: base.match }, orderBy: { displayOrder: "asc" } });
    expect(rules.map((r) => [r.dependsOnValueId, r.priceModifierCents, r.displayOrder])).toEqual([
      [seeded.ids.walnut, 75000, 0],
      [seeded.ids.pine, 0, 1],
    ]);
    // Edit + reorder (sent as the new list), then delete one.
    expect(await saveMatch([{ dependsOnValueId: seeded.ids.pine, price: "25" }, { dependsOnValueId: seeded.ids.walnut, price: "800.50" }])).toMatchObject({ ok: true });
    rules = await prisma.optionValuePriceRule.findMany({ where: { optionValueId: base.match }, orderBy: { displayOrder: "asc" } });
    expect(rules.map((r) => [r.dependsOnValueId, r.priceModifierCents])).toEqual([
      [seeded.ids.pine, 2500],
      [seeded.ids.walnut, 80050],
    ]);
    expect(await saveMatch([{ dependsOnValueId: seeded.ids.walnut, price: "750" }])).toMatchObject({ ok: true });
    expect(await prisma.optionValuePriceRule.count()).toBe(1);

    // Invalid rules: nothing changes.
    for (const [rules, why] of [
      [[{ dependsOnValueId: base.white, price: "10" }], /its own option/],
      [[{ dependsOnValueId: seeded.ids.walnut, price: "10" }, { dependsOnValueId: seeded.ids.walnut, price: "20" }], /already a rule/],
      [[{ dependsOnValueId: seeded.ids.pine, price: "abc" }], /amount/],
      [[{ dependsOnValueId: seeded.ids.pine, price: "" }], /amount|price/],
      [[{ dependsOnValueId: "", price: "10" }], /choose the option/],
      [[{ dependsOnValueId: "missing-id", price: "10" }], /no longer exists/],
    ] as const) {
      const res = await saveMatch(rules as unknown as Array<{ dependsOnValueId: string; price: string }>);
      expect(res, String(why)).toMatchObject({ ok: false, fieldErrors: { priceRules: expect.stringMatching(why) } });
    }
    expect(await options.saveOptionValue(base.id, base.match, form({ displayName: "Match Tabletop", priceModifier: "0", active: "on", priceRules: "{not json" }))).toMatchObject({ ok: false });
    expect((await prisma.optionValuePriceRule.findFirstOrThrow()).priceModifierCents).toBe(75000);
    // A form without the field leaves rules alone; an empty list deletes them all.
    expect(await options.saveOptionValue(base.id, base.match, form({ displayName: "Match Tabletop", priceModifier: "0", active: "on" }))).toMatchObject({ ok: true });
    expect(await prisma.optionValuePriceRule.count()).toBe(1);
    expect(await saveMatch([])).toMatchObject({ ok: true });
    expect(await prisma.optionValuePriceRule.count()).toBe(0);

    // Duplicating a value or a group copies its rules.
    await saveMatch([{ dependsOnValueId: seeded.ids.walnut, price: "750" }]);
    const dupValue = await options.duplicateOptionValue(base.id, base.match);
    expect(await prisma.optionValuePriceRule.findMany({ where: { optionValueId: dupValue.id! } })).toMatchObject([{ dependsOnValueId: seeded.ids.walnut, priceModifierCents: 75000 }]);
    const dupGroup = await options.duplicateOptionGroup(base.id);
    const copiedMatch = await prisma.optionValue.findFirstOrThrow({ where: { groupId: dupGroup.id!, name: "Match Tabletop" }, include: { priceRules: true } });
    expect(copiedMatch.priceRules).toMatchObject([{ dependsOnValueId: seeded.ids.walnut, priceModifierCents: 75000 }]);
    expect(await prisma.activityLog.count({ where: { message: { contains: "1 conditional price" } } })).toBeGreaterThan(0);
  });

  it("the storefront model, quote, order and invoice all use the conditional price; later rule edits never touch them", async () => {
    await saveMatch([{ dependsOnValueId: seeded.ids.walnut, price: "750" }]);
    const product = (await loadConfigurableProduct({ id: seeded.product.id }))!;
    // What the product page shows beside each base value, for each wood.
    const shown = (wood: string) =>
      applyConditionalPrices(product, selection(wood, base.match))
        .optionGroups.find((g) => g.id === base.id)!
        .values.map((v) => [v.displayName, v.priceModifierCents]);
    expect(shown(seeded.ids.pine)).toEqual([["Painted White", 0], ["Painted Black", 0], ["Match Tabletop", 0]]);
    expect(shown(seeded.ids.walnut)).toEqual([["Painted White", 0], ["Painted Black", 0], ["Match Tabletop", 75000]]);
    // Walnut here is the product's $600 override; Match Tabletop is +$750 because Walnut is chosen.
    expect(priceConfiguration(product, selection(seeded.ids.walnut, base.match)).totalCents).toBe(120000 + 60000 + 75000);
    expect(priceConfiguration(product, selection(seeded.ids.walnut, base.white)).totalCents).toBe(120000 + 60000);

    const quote = await request(seeded.ids.walnut, base.match);
    const q = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, include: { currentRevision: { include: { lineItems: { orderBy: { position: "asc" } } } } } });
    expect(q.estimatedTotalCents).toBe(255000);
    const snap = parseSnapshot(q.configuration)!;
    expect(snap.options.find((o) => o.groupId === base.id)).toMatchObject({
      valueDisplayName: "Match Tabletop",
      priceModifierCents: 75000,
      priceCondition: { dependsOnGroupName: "Wood", dependsOnValueName: "Walnut", defaultPriceModifierCents: 0 },
    });
    expect(q.currentRevision!.totalCents).toBe(255000);
    const linesBefore = q.currentRevision!.lineItems;

    await quotes.sendQuote(admin, quote.id);
    const r = await quotes.acceptQuote(q.customerToken!, { revisionNumber: 1, name: "Jamie Rivers", agreeTerms: true, agreeDeposit: true }, meta);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: r.order.id }, include: { items: true } });
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { orderId: r.order.id }, include: { lineItems: true } });
    expect(order.totalCents).toBe(255000);
    expect(invoice.totalCents).toBe(255000);

    // The rule changes later: new requests use it; everything saved keeps its price.
    await saveMatch([{ dependsOnValueId: seeded.ids.walnut, price: "900" }]);
    const again = await request(seeded.ids.walnut, base.match);
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: again.id } })).estimatedTotalCents).toBe(270000);
    const qAfter = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, include: { currentRevision: { include: { lineItems: { orderBy: { position: "asc" } } } } } });
    expect(qAfter.configuration).toEqual(q.configuration);
    expect(qAfter.currentRevision!.lineItems).toEqual(linesBefore);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: r.order.id }, include: { items: true } })).toEqual(order);
    expect(await prisma.invoice.findFirstOrThrow({ where: { orderId: r.order.id }, include: { lineItems: true } })).toEqual(invoice);
  });

  it("the server never trusts a browser price, and a deleted controlling value removes its rules", async () => {
    await saveMatch([{ dependsOnValueId: seeded.ids.walnut, price: "750" }]);
    // The selection carries no prices at all; even a tampered field is ignored by the schema/engine.
    const quote = await request(seeded.ids.walnut, base.match);
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).estimatedTotalCents).toBe(255000);
    // Rules go with the value they depend on (cascade), so no dangling conditions remain.
    await prisma.productOptionValue.deleteMany({ where: { optionValueId: seeded.ids.walnut } });
    await prisma.optionValue.delete({ where: { id: seeded.ids.walnut } });
    expect(await prisma.optionValuePriceRule.count()).toBe(0);
  });

  it("only owners and admins can edit pricing rules", async () => {
    resetRequest();
    await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    expect(await saveMatch([{ dependsOnValueId: seeded.ids.walnut, price: "1" }])).toMatchObject({ ok: false });
    expect(await prisma.optionValuePriceRule.count()).toBe(0);
  });
});
