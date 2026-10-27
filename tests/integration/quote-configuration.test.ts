import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RevisionInput } from "@/lib/sales/quotes";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest } = await import("../support/next-request");
const addOnActions = await import("@/app/admin/(panel)/add-ons/actions");
const sales = await import("@/app/admin/(panel)/sales-actions");
const quotes = await import("@/lib/sales/quotes");
const { loadConfigurableProduct } = await import("@/lib/pricing/load");
const { priceConfiguration } = await import("@/lib/pricing/engine");
const { parseSnapshot, selectionFromSnapshot } = await import("@/lib/pricing/snapshot");
const { loadCustomerQuote, customerInvoiceView, customerOrderView } = await import("@/lib/sales/views");
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const meta = { ip: "198.51.100.7", userAgent: "Mozilla/5.0 test" };
type Selection = Parameters<typeof priceConfiguration>[1];

describe.skipIf(!hasTestDb)("admin quote builder: configuring catalog products", () => {
  let seeded: Awaited<ReturnType<typeof seedRidge>>;
  let admin: { id: string; name: string };
  let base: { id: string; white: string; match: string };
  let chairs: { id: string; style: string; xBack: string };

  beforeEach(async () => {
    await resetDb();
    resetRequest();
    await prisma.siteSetting.create({ data: { id: "default" } });
    const u = await createSignedInAdmin();
    admin = { id: u.id, name: u.name };
    seeded = await seedRidge();
    // Base Material / Finish with a conditional "Match Tabletop" (+$750 with Walnut).
    const g = await prisma.optionGroup.create({
      data: { name: "Base Material / Finish", displayName: "Base", values: { create: [{ name: "Painted White", displayName: "Painted White", priceModifierCents: 0 }, { name: "Match Tabletop", displayName: "Match Tabletop", priceModifierCents: 0, displayOrder: 1 }] } },
      include: { values: true },
    });
    base = { id: g.id, white: g.values.find((v) => v.name === "Painted White")!.id, match: g.values.find((v) => v.name === "Match Tabletop")!.id };
    await prisma.optionValuePriceRule.create({ data: { optionValueId: base.match, dependsOnValueId: seeded.ids.walnut, priceModifierCents: 75000 } });
    await prisma.productOptionGroup.create({ data: { productId: seeded.product.id, optionGroupId: g.id, displayOrder: 2 } });
    // Dining Chairs: configurable add-on, Chair Style sets the price per chair.
    const style = await prisma.optionGroup.create({ data: { name: "Chair Style", displayName: "Chair Style", required: true, values: { create: [{ name: "X Back", displayName: "X Back", priceModifierCents: 19250 }] } }, include: { values: true } });
    const c = await addOnActions.createAddOn(form({ name: "Dining Chairs", displayName: "Add Dining Chairs", price: "0", scope: "REUSABLE", minQuantity: "0", maxQuantity: "8", quantityEnabled: "on", quantityStep: "1", defaultQuantity: "2", active: "on" }));
    await addOnActions.attachAddOnOptionGroup(c.id!, form({ optionGroupId: style.id }));
    await addOnActions.updateAddOnOptionGroup(c.id!, style.id, form({ requiredOverride: "inherit", setsUnitPrice: "on" }));
    await addOnActions.assignAddOnToProduct(c.id!, form({ productId: seeded.product.id, priceOverride: "" }));
    chairs = { id: c.id!, style: style.id, xBack: style.values[0]!.id };
  });

  const selection = (over: Partial<Selection> = {}): Selection => ({
    options: { [seeded.ids.size]: seeded.ids.s84, [seeded.ids.wood]: seeded.ids.walnut, [base.id]: base.match },
    addOns: { [chairs.id]: 6, [seeded.ids.bench]: 1 },
    addOnOptions: { [chairs.id]: { [chairs.style]: chairs.xBack } },
    customDetails: {},
    ...over,
  });
  const newQuote = () => quotes.createManualQuote(admin, { name: "Pat Lee", email: "pat@example.com", phone: null, zipCode: "43215", address: null, notes: null, lines: [] });
  const revisionInput = (lines: RevisionInput["lines"]): RevisionInput => ({
    customerName: "Pat Lee",
    customerEmail: "pat@example.com",
    customerPhone: null,
    customerAddress: null,
    customerNotes: null,
    terms: null,
    expiresAt: null,
    leadTime: null,
    estimatedCompletion: null,
    deliveryDetails: null,
    depositType: "PERCENTAGE",
    depositPercentBps: 5000,
    depositAmountCents: null,
    taxCents: 0,
    lines,
  });
  const configuredLine = (sel: Selection, opts: { quantity?: number; override?: number | null; changed?: boolean; sourceId?: string | null; unitPriceCents?: number } = {}) => ({
    sourceId: opts.sourceId ?? null,
    kind: "PRODUCT" as const,
    description: "The Ridge Dining Table",
    notes: null,
    quantity: opts.quantity ?? 1,
    unitPriceCents: opts.unitPriceCents ?? 0,
    taxable: true,
    productId: seeded.product.id,
    configured: { selection: sel, overrideTotalCents: opts.override ?? null, changed: opts.changed ?? true },
  });
  const draft = async (quoteId: string) =>
    prisma.quoteRevision.findFirstOrThrow({ where: { quoteId, status: "DRAFT" }, orderBy: { number: "desc" }, include: { lineItems: { orderBy: { position: "asc" } } } });

  it("loads every active option and prices exactly like the product page (incl. conditional prices and add-ons)", async () => {
    const forEditor = (await sales.quoteProductConfigAction(seeded.product.id))!;
    const onSite = (await loadConfigurableProduct({ id: seeded.product.id }))!;
    expect(forEditor).toEqual(onSite);
    expect(forEditor.optionGroups.map((g) => g.name)).toEqual(["Dining Table Size", "Wood Species", "Base Material / Finish"]);
    expect(forEditor.addOns.map((a) => a.name)).toEqual(expect.arrayContaining(["Matching Bench", "Add Dining Chairs"]));

    const q = await newQuote();
    const sel = selection();
    await quotes.saveRevision(admin, q.id, revisionInput([configuredLine(sel, { quantity: 2 })]));
    const rev = await draft(q.id);
    const site = priceConfiguration(onSite, sel);
    // 84" + Walnut ($600 product override) + Match Tabletop with Walnut (+$750) + 6 chairs + bench, per table.
    expect(site.totalCents).toBe(120000 + 30000 + 60000 + 75000 + 6 * 19250 + 35000);
    expect(rev.totalCents).toBe(2 * site.totalCents!);
    expect(rev.depositCents).toBe(rev.totalCents / 2);
    expect(rev.balanceCents).toBe(rev.totalCents - rev.depositCents);

    const group = rev.lineItems[0]!.configGroup;
    expect(group).toMatch(/^cfg_/);
    expect(rev.lineItems.every((l) => l.configGroup === group)).toBe(true);
    expect(rev.lineItems.map((l) => [l.kind, l.description, l.quantity])).toEqual([
      ["PRODUCT", "The Ridge Dining Table", 2],
      ["ADDON", "Matching Bench", 2],
      ["ADDON", "Add Dining Chairs", 12],
    ]);
    expect(rev.lineItems[0]!.notes).toBe("Size: 84 × 38\nWood: Walnut\nBase: Match Tabletop");
    const snap = parseSnapshot(rev.lineItems[0]!.configuration)!;
    expect(selectionFromSnapshot(snap)).toMatchObject({ options: sel.options, addOns: sel.addOns, addOnOptions: sel.addOnOptions });
    expect(snap.quotePricing).toEqual({ calculatedTotalCents: site.totalCents, overrideTotalCents: null });
  });

  it("re-prices when the configuration changes, keeps saved prices when it doesn't, and never trusts a browser price", async () => {
    const q = await newQuote();
    await quotes.saveRevision(admin, q.id, revisionInput([configuredLine(selection(), { unitPriceCents: 1 })]));
    let rev = await draft(q.id);
    const first = rev.totalCents;
    expect(first).toBeGreaterThan(1000); // the browser's $0.01 was ignored
    const head = rev.lineItems[0]!;

    // Catalog price changes later; an untouched configuration keeps its saved lines.
    await prisma.product.update({ where: { id: seeded.product.id }, data: { basePriceCents: 130000 } });
    await quotes.saveRevision(admin, q.id, revisionInput([configuredLine(selection(), { changed: false, sourceId: head.id })]));
    rev = await draft(q.id);
    expect(rev.totalCents).toBe(first);
    expect(rev.lineItems[0]!.configGroup).toBe(head.configGroup);

    // Changing options (8' Pine, painted base, no chairs): priced with today's catalog, same group.
    const pine = selection({ options: { [seeded.ids.size]: seeded.ids.s60, [seeded.ids.wood]: seeded.ids.pine, [base.id]: base.white }, addOns: {}, addOnOptions: {} });
    await quotes.saveRevision(admin, q.id, revisionInput([configuredLine(pine, { sourceId: rev.lineItems[0]!.id })]));
    rev = await draft(q.id);
    expect(rev.totalCents).toBe(130000);
    expect(rev.lineItems).toHaveLength(1);
    expect(rev.lineItems[0]!.configGroup).toBe(head.configGroup);

    // An invalid configuration is refused with the engine's message.
    await expect(quotes.saveRevision(admin, q.id, revisionInput([configuredLine({ options: {}, addOns: {} })]))).rejects.toThrow(/choose a size/i);
  });

  it("applies a manual price override but keeps the calculated price internally", async () => {
    const q = await newQuote();
    const sel = selection();
    await quotes.saveRevision(admin, q.id, revisionInput([configuredLine(sel, { quantity: 2, override: 450000 })]));
    const rev = await draft(q.id);
    expect(rev.totalCents).toBe(2 * 450000);
    const snap = parseSnapshot(rev.lineItems[0]!.configuration)!;
    const calculated = priceConfiguration((await loadConfigurableProduct({ id: seeded.product.id }))!, sel).totalCents;
    expect(snap.quotePricing).toEqual({ calculatedTotalCents: calculated, overrideTotalCents: 450000 });
    // Add-ons keep their prices; the table line takes the rest.
    const addOns = rev.lineItems.filter((l) => l.kind === "ADDON").reduce((s, l) => s + l.lineTotalCents, 0);
    expect(rev.lineItems[0]!.lineTotalCents).toBe(900000 - addOns);
    // Never below the add-ons on the piece.
    await expect(quotes.saveRevision(admin, q.id, revisionInput([configuredLine(sel, { override: 1000 })]))).rejects.toThrow(/can't be less than this piece's add-ons/);

    // The customer sees the quoted prices only — never the calculated one.
    await quotes.sendQuote(admin, q.id);
    const quote = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: q.id } });
    const view = (await loadCustomerQuote(quote.customerToken!))!.view;
    expect(view.revision!.totals.totalCents).toBe(900000);
    expect(JSON.stringify(view)).not.toContain(String(calculated));
  });

  it("applies an active sale like the website: the sale on the core price as its own line", async () => {
    await prisma.product.update({ where: { id: seeded.product.id }, data: { saleEnabled: true, saleType: "PERCENT", salePercentBps: 2000, saleStartsAt: new Date(Date.now() - 86_400_000), saleEndsAt: new Date(Date.now() + 86_400_000) } });
    const q = await newQuote();
    const sel = selection({ addOns: {}, addOnOptions: {} });
    await quotes.saveRevision(admin, q.id, revisionInput([configuredLine(sel)]));
    const rev = await draft(q.id);
    const site = priceConfiguration((await loadConfigurableProduct({ id: seeded.product.id }))!, sel);
    expect(rev.totalCents).toBe(site.totalCents);
    expect(rev.lineItems.map((l) => l.kind)).toEqual(["PRODUCT", "DISCOUNT"]);
    expect(rev.lineItems[1]!.lineTotalCents).toBe(-site.savingsCents);
  });

  it("carries the configuration through revisions, customer review, acceptance, order and invoice", async () => {
    const q = await newQuote();
    await quotes.saveRevision(admin, q.id, revisionInput([configuredLine(selection()), { sourceId: null, kind: "DELIVERY", description: "Delivery", notes: null, quantity: 1, unitPriceCents: 25000, taxable: false, productId: null }]));
    await quotes.sendQuote(admin, q.id);
    const sent = await prisma.quoteRevision.findFirstOrThrow({ where: { quoteId: q.id, status: "SENT" }, include: { lineItems: { orderBy: { position: "asc" } } } });

    // A new revision keeps the configuration (and its saved prices) as one group.
    await quotes.createRevision(admin, q.id);
    const rev2 = await draft(q.id);
    expect(rev2.lineItems.map((l) => [l.kind, l.unitPriceCents, l.configGroup])).toEqual(sent.lineItems.map((l) => [l.kind, l.unitPriceCents, l.configGroup]));
    expect(parseSnapshot(rev2.lineItems[0]!.configuration)!.selection).toEqual(parseSnapshot(sent.lineItems[0]!.configuration)!.selection);
    // The catalog changes; the sent revision never does.
    await prisma.product.update({ where: { id: seeded.product.id }, data: { basePriceCents: 999900 } });
    expect(await prisma.quoteRevision.findUniqueOrThrow({ where: { id: sent.id }, include: { lineItems: { orderBy: { position: "asc" } } } })).toEqual(sent);
    await quotes.saveRevision(admin, q.id, revisionInput([{ ...configuredLine(selection(), { changed: false, sourceId: rev2.lineItems[0]!.id }) }, { sourceId: rev2.lineItems.at(-1)!.id, kind: "DELIVERY", description: "Delivery", notes: null, quantity: 1, unitPriceCents: 25000, taxable: false, productId: null }]));
    await quotes.sendQuote(admin, q.id);

    const quote = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: q.id } });
    const view = (await loadCustomerQuote(quote.customerToken!))!.view;
    expect(view.revision!.lines[0]).toMatchObject({ description: "The Ridge Dining Table", notes: "Size: 84 × 38\nWood: Walnut\nBase: Match Tabletop" });
    expect(view.revision!.lines.find((l) => l.description === "Add Dining Chairs")).toMatchObject({ quantity: 6, addOn: { choices: [{ label: "Chair Style", value: "X Back" }] } });

    const r = await quotes.acceptQuote(quote.customerToken!, { revisionNumber: 2, name: "Pat Lee", agreeTerms: true, agreeDeposit: true }, meta);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: r.order.id }, include: { items: { orderBy: { position: "asc" } } } });
    expect(order.totalCents).toBe(sent.totalCents);
    expect(order.depositCents).toBe(sent.totalCents / 2);
    expect(order.items[0]).toMatchObject({ kind: "PRODUCT", notes: "Size: 84 × 38\nWood: Walnut\nBase: Match Tabletop" });
    expect(parseSnapshot(order.items[0]!.configuration)!.selection).toBeDefined();
    const orderView = (await customerOrderView(order.customerToken!))!;
    expect(orderView.items.find((i) => i.description === "Add Dining Chairs")).toMatchObject({ quantity: 6, addOn: { choices: [{ label: "Chair Style", value: "X Back" }] } });
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });
    expect(invoice.totalCents).toBe(sent.totalCents);
    const invoiceView = (await customerInvoiceView(invoice.publicToken!))!;
    expect(invoiceView.lines[0]).toMatchObject({ notes: "Size: 84 × 38\nWood: Walnut\nBase: Match Tabletop" });
  });

  it("saves through the admin action (validated payload; choices only)", async () => {
    const q = await newQuote();
    const payload = {
      customerName: "Pat Lee",
      customerEmail: "pat@example.com",
      depositType: "PERCENTAGE",
      depositPercent: "50",
      taxCents: 0,
      lines: [{ ...configuredLine(selection(), { quantity: 1 }), notes: "", unitPriceCents: 0 }],
    };
    expect(await sales.saveQuoteRevisionAction(q.id, form({ payload: JSON.stringify(payload) }))).toMatchObject({ ok: true });
    const rev = await draft(q.id);
    expect(rev.lineItems[0]!.configGroup).toMatch(/^cfg_/);
    // Malformed choices are rejected by validation.
    const bad = { ...payload, lines: [{ ...payload.lines[0], configured: { selection: { options: { x: 5 } }, overrideTotalCents: null, changed: true } }] };
    expect(await sales.saveQuoteRevisionAction(q.id, form({ payload: JSON.stringify(bad) }))).toMatchObject({ ok: false });
  });

  it("existing quotes without configurations still save and price exactly as before", async () => {
    const q = await quotes.createManualQuote(admin, { name: "Pat Lee", email: "pat@example.com", phone: null, zipCode: "43215", address: null, notes: null, lines: [{ kind: "PRODUCT", description: "Custom bench", notes: "Walnut", quantity: 1, unitPriceCents: 80000, taxable: true, productId: null, configuration: null }] });
    const rev = await draft(q.id);
    await quotes.saveRevision(admin, q.id, revisionInput([{ sourceId: rev.lineItems[0]!.id, kind: "PRODUCT", description: "Custom bench", notes: "Walnut", quantity: 2, unitPriceCents: 85000, taxable: true, productId: null }]));
    const after = await draft(q.id);
    expect(after.lineItems.map((l) => [l.description, l.quantity, l.unitPriceCents, l.configGroup])).toEqual([["Custom bench", 2, 85000, null]]);
    expect(after.totalCents).toBe(170000);
  });

  it("starting a quote from a product adds it as a configured product with the website's defaults", async () => {
    const res = await sales.createManualQuoteAction(form({ name: "Pat Lee", email: "pat@example.com", productId: seeded.product.id }));
    expect(res).toMatchObject({ ok: true });
    const rev = await draft(res.id!);
    const site = (await loadConfigurableProduct({ id: seeded.product.id }))!;
    const { defaultSelection } = await import("@/lib/pricing/engine");
    expect(rev.totalCents).toBe(priceConfiguration(site, defaultSelection(site)).totalCents);
    expect(rev.lineItems[0]!.configGroup).toMatch(/^cfg_/);
  });

  it("website requests become an editable configured group too", async () => {
    const { createConfigurationQuote } = await import("@/lib/services/submissions");
    const req = await createConfigurationQuote({ name: "Jamie", email: "jamie@example.com", phone: null, zipCode: "43215", timeline: null, notes: null, productId: seeded.product.id, selection: { ...selection(), addOns: {}, addOnOptions: {}, customDetails: {} } });
    const rev = await draft(req.id);
    expect(new Set(rev.lineItems.map((l) => l.configGroup)).size).toBe(1);
    expect(rev.lineItems[0]!.configGroup).toMatch(/^cfg_/);
  });

  it("only staff who can price quotes get the configurator data", async () => {
    resetRequest();
    await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    expect(await sales.quoteProductConfigAction(seeded.product.id)).toBeNull(); // editors can't see pricing
    resetRequest();
    await expect(sales.quoteProductConfigAction(seeded.product.id)).rejects.toThrow(/REDIRECT \/admin\/login/); // signed out
  });
});
