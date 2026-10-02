import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest } = await import("../support/next-request");
const options = await import("@/app/admin/(panel)/options/actions");
const addOnActions = await import("@/app/admin/(panel)/add-ons/actions");
const { catalogDeletionImpact } = await import("@/app/admin/(panel)/catalog-impact");
const { createConfigurationQuote } = await import("@/lib/services/submissions");
const { loadConfigurableProduct } = await import("@/lib/pricing/load");
const { priceConfiguration } = await import("@/lib/pricing/engine");
const { parseSnapshot } = await import("@/lib/pricing/snapshot");
const { describeSnapshot } = await import("@/lib/email/notifications");
const quotes = await import("@/lib/sales/quotes");
const { loadCustomerQuote, customerInvoiceView, customerOrderView } = await import("@/lib/sales/views");
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const meta = { ip: "198.51.100.7", userAgent: "Mozilla/5.0 test" };

describe.skipIf(!hasTestDb)("deleting options, values, add-ons and add-on choices", () => {
  let seeded: Awaited<ReturnType<typeof seedRidge>>;
  let admin: { id: string; name: string };
  let chairsId: string;
  let style: { id: string; xBack: string; doubleX: string };

  beforeEach(async () => {
    await resetDb();
    resetRequest();
    await prisma.siteSetting.create({ data: { id: "default" } });
    const u = await createSignedInAdmin();
    admin = { id: u.id, name: u.name };
    seeded = await seedRidge();
    // A second product using the same Wood Species group (with Walnut switched off there).
    const other = await prisma.product.create({ data: { name: "Summit Console", slug: "summit-console", status: "ACTIVE", basePriceCents: 90000 } });
    await prisma.productOptionGroup.create({
      data: { productId: other.id, optionGroupId: seeded.ids.wood, valueOverrides: { create: [{ optionValueId: seeded.ids.walnut, enabled: false }] } },
    });
    // Dining Chairs: a configurable add-on with a Chair Style group, on the Ridge table.
    const g = await prisma.optionGroup.create({
      data: { name: "Chair Style", displayName: "Chair Style", required: true, values: { create: [{ name: "X Back", displayName: "X Back", priceModifierCents: 19250 }, { name: "Double X Back", displayName: "Double X Back", priceModifierCents: 21750, displayOrder: 1 }] } },
      include: { values: true },
    });
    style = { id: g.id, xBack: g.values.find((v) => v.name === "X Back")!.id, doubleX: g.values.find((v) => v.name === "Double X Back")!.id };
    const created = await addOnActions.createAddOn(form({ name: "Dining Chairs", displayName: "Add Dining Chairs", price: "0", scope: "REUSABLE", minQuantity: "0", maxQuantity: "8", quantityEnabled: "on", quantityStep: "1", defaultQuantity: "2", active: "on" }));
    chairsId = created.id!;
    await addOnActions.attachAddOnOptionGroup(chairsId, form({ optionGroupId: style.id }));
    await addOnActions.updateAddOnOptionGroup(chairsId, style.id, form({ requiredOverride: "inherit", setsUnitPrice: "on" }));
    await addOnActions.assignAddOnToProduct(chairsId, form({ productId: seeded.product.id, priceOverride: "" }));
  });

  /** A quote → accepted order + invoice for Walnut with 2 Double X Back chairs, captured before any delete. */
  async function historicalSale() {
    const quote = await createConfigurationQuote({
      name: "Jamie Rivers",
      email: "jamie@example.com",
      phone: null,
      zipCode: "43215",
      timeline: null,
      notes: null,
      productId: seeded.product.id,
      selection: { options: { [seeded.ids.size]: seeded.ids.s60, [seeded.ids.wood]: seeded.ids.walnut }, addOns: { [chairsId]: 2 }, addOnOptions: { [chairsId]: { [style.id]: style.doubleX } }, customDetails: {} },
    });
    const q0 = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } });
    await quotes.sendQuote(admin, quote.id);
    const r = await quotes.acceptQuote(q0.customerToken!, { revisionNumber: 1, name: "Jamie Rivers", agreeTerms: true, agreeDeposit: true }, meta);
    const capture = async () => {
      const q = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, include: { revisions: { include: { lineItems: { orderBy: { position: "asc" } } } } } });
      const order = await prisma.order.findUniqueOrThrow({ where: { id: r.order.id }, include: { items: { orderBy: { position: "asc" } } } });
      const invoice = await prisma.invoice.findFirstOrThrow({ where: { orderId: r.order.id }, include: { lineItems: { orderBy: { position: "asc" } } } });
      return {
        q,
        order,
        invoice,
        quoteView: (await loadCustomerQuote(q.customerToken!))!.view,
        invoiceView: await customerInvoiceView(invoice.publicToken!),
        orderView: await customerOrderView(order.customerToken!),
        email: describeSnapshot(parseSnapshot(q.configuration)!, true),
      };
    };
    return { before: await capture(), capture };
  }

  it("shows where an option group is used, then deletes it everywhere — history untouched, product pages still work", async () => {
    const { before, capture } = await historicalSale();
    expect(before.email.join("\n")).toContain("Walnut");
    const impact = await catalogDeletionImpact("optionGroup", seeded.ids.wood);
    expect(impact).toMatchObject({ found: true, name: "Wood Species", childCount: 2, addOns: [] });
    expect(impact.products.map((p) => p.name)).toEqual(["Summit Console", "The Ridge Dining Table"]);

    expect(await options.deleteOptionGroup(seeded.ids.wood)).toMatchObject({ ok: true, message: expect.stringMatching(/removed from 2 products/) });
    expect(await prisma.optionGroup.findUnique({ where: { id: seeded.ids.wood } })).toBeNull();
    expect(await prisma.productOptionGroup.count({ where: { optionGroupId: seeded.ids.wood } })).toBe(0);
    expect(await prisma.optionValue.count({ where: { groupId: seeded.ids.wood } })).toBe(0);

    // The product page still loads (without the group) and a stale browser selection fails gracefully.
    const product = (await loadConfigurableProduct({ id: seeded.product.id }))!;
    expect(product.optionGroups.map((g) => g.name)).toEqual(["Dining Table Size"]);
    const stale = priceConfiguration(product, { options: { [seeded.ids.size]: seeded.ids.s60, [seeded.ids.wood]: seeded.ids.walnut }, addOns: {} });
    expect(stale).toMatchObject({ valid: false, errors: { _form: expect.stringMatching(/no longer available/) } });

    // Every historical record and view is exactly as before.
    expect(await capture()).toEqual(before);
    expect(await prisma.activityLog.count({ where: { message: { contains: 'deleted option group "Wood Species"' } } })).toBe(1);
  });

  it("deletes one value (Walnut) — removed from products offering it, saved documents unchanged", async () => {
    const { before, capture } = await historicalSale();
    const impact = await catalogDeletionImpact("optionValue", seeded.ids.walnut);
    // The console switched Walnut off, so only the Ridge table offers it.
    expect(impact.products.map((p) => p.name)).toEqual(["The Ridge Dining Table"]);
    expect(impact.name).toBe("Walnut (Wood Species)");
    expect(await options.deleteOptionValue(seeded.ids.wood, seeded.ids.walnut)).toMatchObject({ ok: true });
    const product = (await loadConfigurableProduct({ id: seeded.product.id }))!;
    expect(product.optionGroups.find((g) => g.id === seeded.ids.wood)!.values.map((v) => v.name)).toEqual(["Pine"]);
    expect(await prisma.productOptionValue.count({ where: { optionValueId: seeded.ids.walnut } })).toBe(0);
    expect(await capture()).toEqual(before);
  });

  it("deletes an add-on that products use (Dining Chairs) — order and invoice keep their add-on lines", async () => {
    const { before, capture } = await historicalSale();
    expect(before.order.items.some((i) => i.kind === "ADDON")).toBe(true);
    const impact = await catalogDeletionImpact("addOn", chairsId);
    expect(impact).toMatchObject({ found: true, name: "Dining Chairs", childCount: 1, products: [{ name: "The Ridge Dining Table", status: "ACTIVE" }] });

    expect(await addOnActions.deleteAddOn(chairsId)).toMatchObject({ ok: true, message: expect.stringMatching(/removed from 1 product/) });
    expect(await prisma.addOn.findUnique({ where: { id: chairsId } })).toBeNull();
    expect(await prisma.productAddOn.count({ where: { addOnId: chairsId } })).toBe(0);
    expect(await prisma.optionGroup.findUnique({ where: { id: style.id } })).not.toBeNull(); // the library group stays
    expect((await loadConfigurableProduct({ id: seeded.product.id }))!.addOns.map((a) => a.id)).not.toContain(chairsId);

    const after = await capture();
    expect(after).toEqual(before);
    const chairLine = after.invoiceView!.lines.find((l) => l.description === "Add Dining Chairs");
    expect(chairLine).toMatchObject({ quantity: 2, unitPriceCents: 21750, lineTotalCents: 43500 });
  });

  it("deletes one add-on choice (a chair style) — new configurations can't pick it, history keeps it", async () => {
    const { before, capture } = await historicalSale();
    const impact = await catalogDeletionImpact("optionValue", style.doubleX);
    expect(impact).toMatchObject({ found: true, products: [], addOns: ["Dining Chairs"] });
    expect(await options.deleteOptionValue(style.id, style.doubleX)).toMatchObject({ ok: true });
    const chairs = (await loadConfigurableProduct({ id: seeded.product.id }))!.addOns.find((a) => a.id === chairsId)!;
    expect(chairs.optionGroups[0]!.values.map((v) => v.name)).toEqual(["X Back"]);
    expect(await capture()).toEqual(before);
    expect(JSON.stringify(before.orderView)).toContain("Double X Back");
  });

  it("only owners and admins can see the impact or delete", async () => {
    resetRequest();
    await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    await expect(catalogDeletionImpact("optionGroup", seeded.ids.wood)).rejects.toThrow(/REDIRECT/);
    expect(await options.deleteOptionGroup(seeded.ids.wood)).toMatchObject({ ok: false });
    expect(await options.deleteOptionValue(seeded.ids.wood, seeded.ids.walnut)).toMatchObject({ ok: false });
    expect(await addOnActions.deleteAddOn(chairsId)).toMatchObject({ ok: false });
    expect(await prisma.optionGroup.count({ where: { id: seeded.ids.wood } })).toBe(1);
    expect(await prisma.addOn.count({ where: { id: chairsId } })).toBe(1);
  });

  it("reports an already-deleted item instead of failing", async () => {
    await options.deleteOptionGroup(seeded.ids.wood);
    expect(await catalogDeletionImpact("optionGroup", seeded.ids.wood)).toMatchObject({ found: false });
    expect(await options.deleteOptionGroup(seeded.ids.wood)).toMatchObject({ ok: false, message: expect.stringMatching(/no longer exists/) });
  });
});
