import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest } = await import("../support/next-request");
const actions = await import("@/app/admin/(panel)/products/actions");
const { createConfigurationQuote } = await import("@/lib/services/submissions");
const { parseSnapshot } = await import("@/lib/pricing/snapshot");
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");

const customer = { name: "Pat Buyer", email: "pat@example.com", phone: null, zipCode: "43215", timeline: null, notes: "Test" };

function form(product: { name: string; slug: string }, fields: Record<string, string>) {
  const f = new FormData();
  f.set("name", product.name);
  f.set("slug", product.slug);
  f.set("showPrice", "on");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe.skipIf(!hasTestDb)("product sale prices", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.siteSetting.create({ data: { id: "default" } });
    resetRequest();
  });

  it("saves a sale (dollars or percent), validates it server-side and logs the change", async () => {
    await createSignedInAdmin();
    const { product } = await seedRidge();

    const ok = await actions.saveProduct(product.id, form(product, { basePrice: "1295", saleEnabled: "on", saleLabel: "Fall Sale", salePrice: "20%", saleStarts: "2026-10-01", saleEnds: "2026-10-14" }));
    expect(ok.ok).toBe(true);
    const saved = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    // Stored as entered: a 20% sale, not a converted price.
    expect(saved).toMatchObject({ saleEnabled: true, saleLabel: "Fall Sale", saleType: "PERCENT", salePercentBps: 2000, salePriceCents: null });
    expect(saved.saleStartsAt!.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(saved.saleEndsAt!.toISOString()).toBe("2026-10-15T04:00:00.000Z");
    expect(await prisma.activityLog.count({ where: { type: "product.sale_updated", entityId: product.id } })).toBe(1);

    const notLower = await actions.saveProduct(product.id, form(product, { basePrice: "1200", saleEnabled: "on", salePrice: "1500" }));
    expect(notLower).toMatchObject({ ok: false, fieldErrors: { salePrice: expect.stringMatching(/lower than the regular/) } });
    // Rejected even while switched off, so it can't be enabled later.
    const equalOff = await actions.saveProduct(product.id, form(product, { basePrice: "1200", salePrice: "1200" }));
    expect(equalOff).toMatchObject({ ok: false, fieldErrors: { salePrice: expect.any(String) } });
    const enabledBlank = await actions.saveProduct(product.id, form(product, { basePrice: "1200", saleEnabled: "on", salePrice: "" }));
    expect(enabledBlank).toMatchObject({ ok: false, fieldErrors: { salePrice: expect.any(String) } });
    const longLabel = await actions.saveProduct(product.id, form(product, { basePrice: "1200", salePrice: "995", saleLabel: "x".repeat(41) }));
    expect(longLabel).toMatchObject({ ok: false, fieldErrors: { saleLabel: expect.any(String) } });
    const backwards = await actions.saveProduct(product.id, form(product, { basePrice: "1200", salePrice: "995", saleStarts: "2026-10-14", saleEnds: "2026-10-01" }));
    expect(backwards).toMatchObject({ ok: false, fieldErrors: { saleEnds: expect.any(String) } });
    const noBase = await actions.saveProduct(product.id, form(product, { basePrice: "", salePrice: "995" }));
    expect(noBase).toMatchObject({ ok: false, fieldErrors: { salePrice: expect.any(String) } });
    // Rejected saves change nothing.
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ saleType: "PERCENT", salePercentBps: 2000 });

    const off = await actions.saveProduct(product.id, form(product, { basePrice: "1295", salePrice: "1036" }));
    expect(off.ok).toBe(true);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ saleEnabled: false, saleType: "FIXED_PRICE", salePercentBps: null, salePriceCents: 103600 });

    const cleared = await actions.saveProduct(product.id, form(product, { basePrice: "1200", salePrice: "", saleStarts: "2026-10-01" }));
    expect(cleared.ok).toBe(true);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ saleEnabled: false, saleType: null, salePercentBps: null, salePriceCents: null, saleStartsAt: null, saleEndsAt: null });
    expect(await prisma.activityLog.count({ where: { type: "product.sale_removed" } })).toBe(2);
  });

  it("never publishes with a bad sale price", async () => {
    await createSignedInAdmin();
    const { product } = await seedRidge("DRAFT");
    const res = await actions.saveProduct(product.id, form(product, { intent: "publish", basePrice: "1200", saleEnabled: "on", salePrice: "1300" }));
    expect(res.ok).toBe(false);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe("DRAFT");
  });

  it("a 30% sale entered on $225 is priced at $158 and advertised as 30% off, end to end", async () => {
    await createSignedInAdmin();
    const { product } = await seedRidge();
    expect((await actions.saveProduct(product.id, form(product, { basePrice: "225", saleEnabled: "on", salePrice: "30%" }))).ok).toBe(true);
    const { getCatalogProducts } = await import("@/lib/catalog/queries");
    const [card] = await getCatalogProducts();
    expect(card).toMatchObject({ startingPriceCents: 15800, regularPriceCents: 22500, sale: { percentOff: 30 } });
    expect(await prisma.activityLog.findFirst({ where: { type: "product.sale_updated" } })).toMatchObject({ message: expect.stringContaining("30% off") });

    // A fixed $158 derives its percentage instead.
    expect((await actions.saveProduct(product.id, form(product, { basePrice: "225", saleEnabled: "on", salePrice: "158" }))).ok).toBe(true);
    expect((await getCatalogProducts())[0]).toMatchObject({ startingPriceCents: 15800, sale: { percentOff: 29 } });
  });

  it("refuses to change a sale without an admin session", async () => {
    const { product } = await seedRidge();
    await expect(actions.saveProduct(product.id, form(product, { basePrice: "1200", salePrice: "1" }))).rejects.toThrow();
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).salePriceCents).toBeNull();
  });

  it("prices quotes at the sale price server-side, only while the sale is running", async () => {
    const { product, ids } = await seedRidge();
    const selection = { options: { [ids.size]: ids.s84, [ids.wood]: ids.walnut }, addOns: {}, customDetails: {} };
    await prisma.product.update({ where: { id: product.id }, data: { saleEnabled: true, saleType: "FIXED_PRICE", salePriceCents: 99500, saleEndsAt: new Date(Date.now() + 86_400_000) } });

    const onSale = await createConfigurationQuote({ ...customer, productId: product.id, selection });
    expect(onSale.estimatedTotalCents).toBe(99500 + 30000 + 60000);
    expect(parseSnapshot(onSale.configuration)!.sale).toEqual({ regularBasePriceCents: 120000, savingsCents: 20500, label: null, percent: null });

    await prisma.product.update({ where: { id: product.id }, data: { saleEndsAt: new Date(Date.now() - 1000) } });
    const after = await createConfigurationQuote({ ...customer, productId: product.id, selection });
    expect(after.estimatedTotalCents).toBe(120000 + 30000 + 60000);
    expect(parseSnapshot(after.configuration)!.sale).toBeNull();
    // The earlier quote keeps the price the customer was shown.
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: onSale.id } })).estimatedTotalCents).toBe(189500);
  });
});
