import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest } = await import("../support/next-request");
const addOnActions = await import("@/app/admin/(panel)/add-ons/actions");
const optionActions = await import("@/app/admin/(panel)/options/actions");
const { createConfigurationQuote } = await import("@/lib/services/submissions");
const { loadAddOnPreview, loadConfigurableProduct } = await import("@/lib/pricing/load");
const { configuredAddOnUnitPrice, priceConfiguration } = await import("@/lib/pricing/engine");
const { parseSnapshot, parseAddOnLine } = await import("@/lib/pricing/snapshot");
const { describeSnapshot } = await import("@/lib/email/notifications");
const { configurationQuoteSchema } = await import("@/lib/validation/forms");
const quotes = await import("@/lib/sales/quotes");
const { loadCustomerQuote, customerInvoiceView, customerOrderView } = await import("@/lib/sales/views");
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const meta = { ip: "198.51.100.7", userAgent: "Mozilla/5.0 test" };

describe.skipIf(!hasTestDb)("configurable add-ons end to end", () => {
  let seeded: Awaited<ReturnType<typeof seedRidge>>;
  let admin: { id: string; name: string };
  let chairsId: string;
  let ids: Record<string, string>;

  async function libraryGroup(name: string, displayName: string, inputType: "IMAGE" | "SWATCH", values: Array<[string, number]>) {
    const g = await prisma.optionGroup.create({ data: { name, displayName, inputType, required: true, values: { create: values.map(([n, p], i) => ({ name: n, displayName: n, priceModifierCents: p, displayOrder: i })) } }, include: { values: true } });
    for (const v of g.values) ids[`${name}:${v.name}`] = v.id;
    ids[name] = g.id;
    return g;
  }

  beforeEach(async () => {
    await resetDb();
    resetRequest();
    await prisma.siteSetting.create({ data: { id: "default" } });
    const u = await createSignedInAdmin();
    admin = { id: u.id, name: u.name };
    seeded = await seedRidge();
    ids = {};
    // The add-on itself, created in admin.
    const created = await addOnActions.createAddOn(
      form({ name: "Dining Chairs", displayName: "Add Dining Chairs", description: "Add matching dining chairs to complete your table set.", price: "192.50", scope: "REUSABLE", minQuantity: "2", maxQuantity: "12", quantityEnabled: "on", quantityStep: "1", defaultQuantity: "4", active: "on" }),
    );
    expect(created).toMatchObject({ ok: true });
    chairsId = created.id!;
    // Its own option groups (from the library), attached in admin.
    await libraryGroup("Chair Style", "Chair Style", "IMAGE", [["X Back", 0], ["Double X Back", 2500]]);
    await libraryGroup("Chair Wood Species", "Wood Species", "IMAGE", [["Pine", 0], ["Oak", 2000], ["Walnut", 6000]]);
    await libraryGroup("Chair Finish", "Chair Finish", "SWATCH", [["Natural", 0], ["Black", 1500]]);
    await libraryGroup("Seat Finish", "Seat Finish", "SWATCH", [["Natural", 0], ["Special Walnut", 1000]]);
    for (const g of ["Chair Style", "Chair Wood Species", "Chair Finish", "Seat Finish"]) {
      expect(await addOnActions.attachAddOnOptionGroup(chairsId, form({ optionGroupId: ids[g]! }))).toMatchObject({ ok: true });
    }
    await addOnActions.updateAddOnOptionGroup(chairsId, ids["Chair Style"]!, form({ displayNameOverride: "Choose Your Chair Style", requiredOverride: "inherit" }));
    // Attached to the dining table (and could be attached to many).
    expect(await addOnActions.assignAddOnToProduct(chairsId, form({ productId: seeded.product.id, priceOverride: "" }))).toMatchObject({ ok: true });
  });

  const selection = (qty: number) => ({
    options: { [seeded.ids.size]: seeded.ids.s60, [seeded.ids.wood]: seeded.ids.pine },
    addOns: { [chairsId]: qty },
    addOnOptions: { [chairsId]: { [ids["Chair Style"]!]: ids["Chair Style:X Back"]!, [ids["Chair Wood Species"]!]: ids["Chair Wood Species:Oak"]!, [ids["Chair Finish"]!]: ids["Chair Finish:Black"]!, [ids["Seat Finish"]!]: ids["Seat Finish:Special Walnut"]! } },
    customDetails: {},
  });

  it("admin settings are saved and the product page gets the add-on with its own groups", async () => {
    expect(await prisma.addOn.findUniqueOrThrow({ where: { id: chairsId } })).toMatchObject({ name: "Dining Chairs", displayName: "Add Dining Chairs", priceCents: 19250, minQuantity: 2, maxQuantity: 12, quantityEnabled: true, quantityStep: 1, defaultQuantity: 4 });
    const product = (await loadConfigurableProduct({ id: seeded.product.id }))!;
    const chairs = product.addOns.find((a) => a.id === chairsId)!;
    expect(chairs.name).toBe("Add Dining Chairs");
    expect(chairs.optionGroups.map((g) => [g.displayName, g.inputType, g.values.length])).toEqual([
      ["Choose Your Chair Style", "IMAGE", 2],
      ["Wood Species", "IMAGE", 3],
      ["Chair Finish", "SWATCH", 2],
      ["Seat Finish", "SWATCH", 2],
    ]);
    // The table's own option groups are untouched.
    expect(product.optionGroups.map((g) => g.displayName)).toEqual(["Size", "Wood"]);

    // Bad settings are refused.
    expect(await addOnActions.updateAddOn(chairsId, form({ name: "Dining Chairs", price: "192.50", minQuantity: "2", maxQuantity: "12", quantityEnabled: "on", quantityStep: "2", defaultQuantity: "5", active: "on" }))).toMatchObject({ ok: false });
    // Library groups used by an add-on can't be deleted out from under it.
    expect(await optionActions.deleteOptionGroup(ids["Chair Style"]!)).toMatchObject({ ok: false, message: expect.stringMatching(/configurable add-on/) });
  });

  it("a quote request keeps the chairs grouped under the table through quote, order and invoice", async () => {
    const parsed = configurationQuoteSchema.shape.selection.parse(JSON.stringify(selection(6)));
    const quote = await createConfigurationQuote({ name: "Jamie Rivers", email: "jamie@example.com", phone: null, zipCode: "43215", timeline: null, notes: null, productId: seeded.product.id, selection: parsed });
    const perChair = 19250 + 2000 + 1500 + 1000; // $237.50
    const q = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, include: { currentRevision: { include: { lineItems: { orderBy: { position: "asc" } } } } } });
    const snap = parseSnapshot(q.configuration)!;
    expect(snap.totalCents).toBe(120000 + perChair * 6);
    expect(snap.addOns[0]).toMatchObject({ name: "Add Dining Chairs", quantity: 6, unitPriceCents: perChair });

    // Draft quote: the table line, then the chairs line carrying every choice.
    const lines = q.currentRevision!.lineItems;
    expect(lines.map((l) => [l.kind, l.description, l.quantity, l.unitPriceCents, l.lineTotalCents])).toEqual([
      ["PRODUCT", "The Ridge Dining Table", 1, 120000, 120000],
      ["ADDON", "Add Dining Chairs", 6, perChair, perChair * 6],
    ]);
    const chairLine = parseAddOnLine(lines[1]!.addOn)!;
    expect(chairLine).toMatchObject({ name: "Add Dining Chairs", parentProduct: { name: "The Ridge Dining Table" }, basePriceCents: 19250, unitPriceCents: perChair });
    expect(chairLine.choices.map((c) => `${c.label}: ${c.value}`)).toEqual(["Choose Your Chair Style: X Back", "Wood Species: Oak", "Chair Finish: Black", "Seat Finish: Special Walnut"]);
    expect(lines[1]!.notes).toBe("Choose Your Chair Style: X Back\nWood Species: Oak\nChair Finish: Black\nSeat Finish: Special Walnut");
    expect(lines[0]!.addOn).toBeNull();

    // Email summary keeps them grouped.
    expect(describeSnapshot(snap, true).join("\n")).toContain("Add-on: Add Dining Chairs × 6\n  Choose Your Chair Style: X Back\n  Wood Species: Oak\n  Chair Finish: Black\n  Seat Finish: Special Walnut");

    // Editing the draft (e.g. a price change) keeps the add-on details on its line.
    await quotes.saveRevision(admin, quote.id, {
      customerName: "Jamie Rivers", customerEmail: "jamie@example.com", customerPhone: null, customerAddress: null, customerNotes: null, terms: null, expiresAt: null, leadTime: null, estimatedCompletion: null, deliveryDetails: null,
      depositType: "PERCENTAGE", depositPercentBps: 5000, depositAmountCents: null, taxCents: 0,
      lines: lines.map((l) => ({ sourceId: l.id, kind: l.kind, description: l.description, notes: l.notes, quantity: l.quantity, unitPriceCents: l.kind === "ADDON" ? 23000 : l.unitPriceCents, taxable: l.taxable, productId: l.productId })),
    });
    await quotes.sendQuote(admin, quote.id);
    const sent = await prisma.quoteRevision.findFirstOrThrow({ where: { quoteId: quote.id }, include: { lineItems: { orderBy: { position: "asc" } } } });
    expect(parseAddOnLine(sent.lineItems[1]!.addOn)!.choices).toHaveLength(4);

    // Customer quote page: the chairs line is marked as an add-on with its choices.
    const view = (await loadCustomerQuote(q.customerToken!))!.view;
    const cl = view.revision!.lines;
    expect(cl[0]!.addOn).toBeNull();
    expect(cl[1]!.addOn).toEqual({ name: "Add Dining Chairs", forProduct: "The Ridge Dining Table", choices: [
      { label: "Choose Your Chair Style", value: "X Back" },
      { label: "Wood Species", value: "Oak" },
      { label: "Chair Finish", value: "Black" },
      { label: "Seat Finish", value: "Special Walnut" },
    ] });
    expect(JSON.stringify(cl[1]!.addOn)).not.toMatch(/"(addOnId|valueId|groupId)"/);

    // A new revision copies it too.
    await quotes.createRevision(admin, quote.id);
    const rev2 = await prisma.quoteRevision.findFirstOrThrow({ where: { quoteId: quote.id, number: 2 }, include: { lineItems: { orderBy: { position: "asc" } } } });
    expect(parseAddOnLine(rev2.lineItems[1]!.addOn)).toMatchObject({ name: "Add Dining Chairs" });
    await quotes.sendQuote(admin, quote.id);

    // Accept → the order's items and its invoice lines carry the add-on.
    const r = await quotes.acceptQuote(q.customerToken!, { revisionNumber: 2, name: "Jamie Rivers", agreeTerms: true, agreeDeposit: true }, meta);
    const items = await prisma.orderItem.findMany({ where: { orderId: r.order.id }, orderBy: { position: "asc" } });
    expect(items.map((i) => [i.kind, i.description, i.quantity])).toEqual([["PRODUCT", "The Ridge Dining Table", 1], ["ADDON", "Add Dining Chairs", 6]]);
    expect(parseAddOnLine(items[1]!.addOn)).toMatchObject({ name: "Add Dining Chairs", parentProduct: { name: "The Ridge Dining Table" } });
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { orderId: r.order.id }, include: { lineItems: { orderBy: { position: "asc" } } } });
    expect(parseAddOnLine(invoice.lineItems[1]!.addOn)!.choices.map((c) => c.value)).toEqual(["X Back", "Oak", "Black", "Special Walnut"]);
    expect(invoice.lineItems[0]!.addOn).toBeNull();

    const iv = (await customerInvoiceView(invoice.publicToken!))!;
    expect(iv.lines[1]!.addOn).toMatchObject({ name: "Add Dining Chairs", choices: expect.arrayContaining([{ label: "Seat Finish", value: "Special Walnut" }]) });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: r.order.id } });
    const ov = (await customerOrderView(order.customerToken!))!;
    expect(ov.items[1]).toMatchObject({ description: "Add Dining Chairs", quantity: 6, unitPriceCents: 23000, addOn: { name: "Add Dining Chairs" } });

    // The accepted (frozen) record keeps it as well.
    const accepted = await prisma.quoteRevision.findFirstOrThrow({ where: { quoteId: quote.id, number: 2 } });
    expect(JSON.stringify(accepted.acceptedSnapshot)).toContain("Special Walnut");
  });

  it("No chairs: the table alone; and the server refuses an incomplete or tampered chair configuration", async () => {
    const none = await createConfigurationQuote({ name: "Jamie Rivers", email: "jamie@example.com", phone: null, zipCode: "43215", timeline: null, notes: null, productId: seeded.product.id, selection: selection(0) });
    const q = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: none.id }, include: { currentRevision: { include: { lineItems: true } } } });
    expect(q.estimatedTotalCents).toBe(120000);
    expect(q.currentRevision!.lineItems.map((l) => l.description)).toEqual(["The Ridge Dining Table"]);

    const incomplete = selection(4);
    delete incomplete.addOnOptions[chairsId]![ids["Seat Finish"]!];
    await expect(createConfigurationQuote({ name: "J R", email: "j@example.com", phone: null, zipCode: "43215", timeline: null, notes: null, productId: seeded.product.id, selection: incomplete })).rejects.toMatchObject({
      fieldErrors: { [`${chairsId}.${ids["Seat Finish"]}`]: expect.stringMatching(/seat finish/i) },
    });
    const tampered = selection(4);
    tampered.addOnOptions[chairsId]![ids["Chair Style"]!] = ids["Seat Finish:Natural"]!;
    await expect(createConfigurationQuote({ name: "J R", email: "j@example.com", phone: null, zipCode: "43215", timeline: null, notes: null, productId: seeded.product.id, selection: tampered })).rejects.toBeTruthy();
    expect(await prisma.quoteRequest.count()).toBe(1);
  });

  it("2 × $192.50 = $385 on every surface when the chair style sets the per-chair price; saved quotes never change", async () => {
    // The owner's setup: X Back Farm Chair = $192.50 per chair on the style, and $192.50 also typed into the add-on base.
    await prisma.optionValue.update({ where: { id: ids["Chair Style:X Back"]! }, data: { displayName: "X Back Farm Chair", priceModifierCents: 19250 } });
    const free = { [ids["Chair Style"]!]: ids["Chair Style:X Back"]!, [ids["Chair Wood Species"]!]: ids["Chair Wood Species:Pine"]!, [ids["Chair Finish"]!]: ids["Chair Finish:Natural"]!, [ids["Seat Finish"]!]: ids["Seat Finish:Natural"]! };
    const sel = { options: { [seeded.ids.size]: seeded.ids.s60, [seeded.ids.wood]: seeded.ids.pine }, addOns: { [chairsId]: 2 }, addOnOptions: { [chairsId]: free }, customDetails: {} };
    const request = () => createConfigurationQuote({ name: "Jamie Rivers", email: "jamie@example.com", phone: null, zipCode: "43215", timeline: null, notes: null, productId: seeded.product.id, selection: sel });

    // Before the switch: the style price is an ADJUSTMENT on top of the base → $385 per chair → $770 (the reported number).
    const before = await request();
    const beforeLine = await prisma.quoteLineItem.findFirstOrThrow({ where: { revision: { quoteId: before.id }, kind: "ADDON" } });
    expect([beforeLine.unitPriceCents, beforeLine.quantity, beforeLine.lineTotalCents]).toEqual([38500, 2, 77000]);
    const preview1 = (await loadAddOnPreview(chairsId))!;
    expect(configuredAddOnUnitPrice(preview1, free).unitCents).toBe(38500);

    // Admin turns on "Sets the price per unit" for Chair Style.
    expect(await addOnActions.updateAddOnOptionGroup(chairsId, ids["Chair Style"]!, form({ displayNameOverride: "Choose Your Chair Style", requiredOverride: "inherit", setsUnitPrice: "on" }))).toMatchObject({ ok: true });
    // Only one group can set the price.
    await addOnActions.updateAddOnOptionGroup(chairsId, ids["Chair Wood Species"]!, form({ setsUnitPrice: "on", requiredOverride: "inherit" }));
    await addOnActions.updateAddOnOptionGroup(chairsId, ids["Chair Style"]!, form({ setsUnitPrice: "on", requiredOverride: "inherit" }));
    expect((await prisma.addOnOptionGroup.findMany({ where: { addOnId: chairsId, setsUnitPrice: true } })).map((g) => g.optionGroupId)).toEqual([ids["Chair Style"]]);

    // Product page / server pricing (same canonical function).
    const product = (await loadConfigurableProduct({ id: seeded.product.id }))!;
    const pricing = priceConfiguration(product, sel);
    expect(pricing.lines.find((l) => l.kind === "addon")).toMatchObject({ quantity: 2, unitCents: 19250, amountCents: 38500 });
    expect(pricing.totalCents).toBe(120000 + 38500);
    expect(configuredAddOnUnitPrice((await loadAddOnPreview(chairsId))!, free).unitCents).toBe(19250);

    // Quote creation, snapshot and email text.
    const quote = await request();
    const q = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, include: { currentRevision: { include: { lineItems: { orderBy: { position: "asc" } } } } } });
    const snap = parseSnapshot(q.configuration)!;
    expect(snap.addOns[0]).toMatchObject({ quantity: 2, unitPriceCents: 19250, totalCents: 38500 });
    expect(q.estimatedTotalCents).toBe(158500);
    expect(describeSnapshot(snap, true).join("\n")).toContain("$192.50 each · $385 total");
    // Quote lines (admin quote view and customer quote page read these).
    const chairLine = q.currentRevision!.lineItems[1]!;
    expect([chairLine.description, chairLine.quantity, chairLine.unitPriceCents, chairLine.lineTotalCents]).toEqual(["Add Dining Chairs", 2, 19250, 38500]);
    expect(parseAddOnLine(chairLine.addOn)).toMatchObject({ unitPriceCents: 19250, basePriceCents: 19250 });
    expect(q.currentRevision!.totalCents).toBe(158500);
    await quotes.sendQuote(admin, quote.id);
    const view = (await loadCustomerQuote(q.customerToken!))!.view;
    expect(view.revision!.lines[1]).toMatchObject({ quantity: 2, unitPriceCents: 19250, lineTotalCents: 38500 });

    // Order and invoice.
    const r = await quotes.acceptQuote(q.customerToken!, { revisionNumber: 1, name: "Jamie Rivers", agreeTerms: true, agreeDeposit: true }, meta);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: r.order.id, kind: "ADDON" } });
    expect([item.quantity, item.unitPriceCents, item.lineTotalCents]).toEqual([2, 19250, 38500]);
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { orderId: r.order.id }, include: { lineItems: { where: { kind: "ADDON" } } } });
    expect([invoice.lineItems[0]!.quantity, invoice.lineItems[0]!.unitPriceCents, invoice.lineItems[0]!.lineTotalCents]).toEqual([2, 19250, 38500]);
    expect(invoice.totalCents).toBe(158500);
    expect((await customerInvoiceView(invoice.publicToken!))!.lines[1]).toMatchObject({ quantity: 2, unitPriceCents: 19250, lineTotalCents: 38500 });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: r.order.id } });
    expect(order.totalCents).toBe(158500);
    expect((await customerOrderView(order.customerToken!))!.items[1]).toMatchObject({ quantity: 2, unitPriceCents: 19250, lineTotalCents: 38500 });

    // The quote saved before the change is exactly as it was (never recalculated).
    expect(await prisma.quoteLineItem.findUniqueOrThrow({ where: { id: beforeLine.id } })).toEqual(beforeLine);
  });

  it("existing quote lines, orders and invoices without add-on details are untouched", async () => {
    // A line saved before this feature (no addOn column value) reads exactly as before.
    const q = await quotes.createManualQuote(admin, { name: "Pat Lee", email: "pat@example.com", phone: null, zipCode: "43215", address: null, notes: null, lines: [{ kind: "ADDON", description: "Matching Bench", notes: null, quantity: 1, unitPriceCents: 35000, taxable: true, productId: null, configuration: null }] });
    const line = await prisma.quoteLineItem.findFirstOrThrow({ where: { revision: { quoteId: q.id } } });
    expect(line.addOn).toBeNull();
    await quotes.sendQuote(admin, q.id);
    const view = (await loadCustomerQuote((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: q.id } })).customerToken!))!.view;
    expect(view.revision!.lines[0]).toMatchObject({ description: "Matching Bench", addOn: null });
    // Simple add-ons on the product keep their behavior.
    const product = (await loadConfigurableProduct({ id: seeded.product.id }))!;
    expect(product.addOns.find((a) => a.name === "Matching Bench")).toMatchObject({ optionGroups: [], quantityEnabled: true, quantityStep: 1, maxQuantity: 2 });
  });
  it("duplicates an add-on with its configuration, unassigned, leaving the original and saved quotes alone", async () => {
    await addOnActions.updateAddOnOptionGroup(chairsId, ids["Chair Style"]!, form({ displayNameOverride: "Choose Your Chair Style", requiredOverride: "required", setsUnitPrice: "on" }));
    const quote = await createConfigurationQuote({ name: "Jamie Rivers", email: "jamie@example.com", phone: null, zipCode: "43215", timeline: null, notes: null, productId: seeded.product.id, selection: selection(2) });
    const savedSnapshot = (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).configuration;
    const originalBefore = await prisma.addOn.findUniqueOrThrow({ where: { id: chairsId }, include: { optionGroups: true, products: true } });
    const [groupsBefore, valuesBefore] = [await prisma.optionGroup.count(), await prisma.optionValue.count()];

    const res = await addOnActions.duplicateAddOn(chairsId);
    expect(res).toMatchObject({ ok: true, id: expect.any(String) });
    const copy = await prisma.addOn.findUniqueOrThrow({ where: { id: res.id! }, include: { optionGroups: { orderBy: { displayOrder: "asc" } }, products: true } });
    expect(copy).toMatchObject({
      name: "Copy of Dining Chairs",
      displayName: "Add Dining Chairs",
      description: "Add matching dining chairs to complete your table set.",
      priceCents: 19250,
      scope: "REUSABLE",
      minQuantity: 2,
      maxQuantity: 12,
      quantityEnabled: true,
      quantityStep: 1,
      defaultQuantity: 4,
      active: true,
      archivedAt: null,
    });
    expect(copy.displayOrder).toBeGreaterThan(originalBefore.displayOrder);
    // Same library groups (shared, not copied), same order and per-add-on settings.
    expect(copy.optionGroups.map((g) => [g.optionGroupId, g.displayNameOverride, g.requiredOverride, g.setsUnitPrice])).toEqual([
      [ids["Chair Style"], "Choose Your Chair Style", true, true],
      [ids["Chair Wood Species"], null, null, false],
      [ids["Chair Finish"], null, null, false],
      [ids["Seat Finish"], null, null, false],
    ]);
    expect([await prisma.optionGroup.count(), await prisma.optionValue.count()]).toEqual([groupsBefore, valuesBefore]);
    // Not assigned anywhere: the product page is unchanged.
    expect(copy.products).toEqual([]);
    expect((await loadConfigurableProduct({ id: seeded.product.id }))!.addOns.map((a) => a.id)).not.toContain(copy.id);
    // It prices exactly like the original once previewed.
    const [orig, dup] = [(await loadAddOnPreview(chairsId))!, (await loadAddOnPreview(copy.id))!];
    const picks = Object.fromEntries(orig.optionGroups.map((g) => [g.id, g.values[0]!.id]));
    expect(configuredAddOnUnitPrice(dup, picks).unitCents).toBe(configuredAddOnUnitPrice(orig, picks).unitCents);

    // The original and the saved quote are untouched; editing the copy doesn't touch the original.
    const originalAfter = await prisma.addOn.findUniqueOrThrow({ where: { id: chairsId }, include: { optionGroups: true, products: true } });
    expect(originalAfter).toEqual(originalBefore);
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).configuration).toEqual(savedSnapshot);
    await addOnActions.detachAddOnOptionGroup(copy.id, ids["Seat Finish"]!);
    expect(await prisma.addOnOptionGroup.count({ where: { addOnId: chairsId } })).toBe(4);

    // Names stay unique; an archived add-on can be duplicated too (the copy isn't archived).
    expect((await addOnActions.duplicateAddOn(chairsId)).id).toBeTruthy();
    expect(await prisma.addOn.findFirst({ where: { name: "Copy of Dining Chairs (2)" } })).not.toBeNull();
    await addOnActions.archiveAddOn(chairsId);
    const fromArchived = await addOnActions.duplicateAddOn(chairsId);
    expect(await prisma.addOn.findUniqueOrThrow({ where: { id: fromArchived.id! } })).toMatchObject({ name: "Copy of Dining Chairs (3)", archivedAt: null });
    expect(await addOnActions.duplicateAddOn("missing")).toMatchObject({ ok: false });
    expect(await prisma.activityLog.count({ where: { type: "addon.updated", message: { contains: "duplicated add-on" } } })).toBe(3);
  });

  it("only admins can duplicate add-ons", async () => {
    resetRequest();
    await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    const before = await prisma.addOn.count();
    expect(await addOnActions.duplicateAddOn(chairsId)).toMatchObject({ ok: false });
    expect(await prisma.addOn.count()).toBe(before);
  });
});
