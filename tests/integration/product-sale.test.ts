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

    const ok = await actions.saveProduct(product.id, form(product, { basePrice: "1295", salePrice: "20%", saleStarts: "2026-10-01", saleEnds: "2026-10-14" }));
    expect(ok.ok).toBe(true);
    const saved = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(saved.salePriceCents).toBe(103600);
    expect(saved.saleStartsAt!.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(saved.saleEndsAt!.toISOString()).toBe("2026-10-15T04:00:00.000Z");
    expect(await prisma.activityLog.count({ where: { type: "product.sale_updated", entityId: product.id } })).toBe(1);

    const notLower = await actions.saveProduct(product.id, form(product, { basePrice: "1200", salePrice: "1500" }));
    expect(notLower).toMatchObject({ ok: false, fieldErrors: { salePrice: expect.stringMatching(/lower than the base/) } });
    const backwards = await actions.saveProduct(product.id, form(product, { basePrice: "1200", salePrice: "995", saleStarts: "2026-10-14", saleEnds: "2026-10-01" }));
    expect(backwards).toMatchObject({ ok: false, fieldErrors: { saleEnds: expect.any(String) } });
    const noBase = await actions.saveProduct(product.id, form(product, { basePrice: "", salePrice: "995" }));
    expect(noBase).toMatchObject({ ok: false, fieldErrors: { salePrice: expect.any(String) } });
    // Rejected saves change nothing.
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).salePriceCents).toBe(103600);

    const cleared = await actions.saveProduct(product.id, form(product, { basePrice: "1200", salePrice: "", saleStarts: "2026-10-01" }));
    expect(cleared.ok).toBe(true);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ salePriceCents: null, saleStartsAt: null, saleEndsAt: null });
    expect(await prisma.activityLog.count({ where: { type: "product.sale_removed" } })).toBe(1);
  });

  it("refuses to change a sale without an admin session", async () => {
    const { product } = await seedRidge();
    await expect(actions.saveProduct(product.id, form(product, { basePrice: "1200", salePrice: "1" }))).rejects.toThrow();
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).salePriceCents).toBeNull();
  });

  it("prices quotes at the sale price server-side, only while the sale is running", async () => {
    const { product, ids } = await seedRidge();
    const selection = { options: { [ids.size]: ids.s84, [ids.wood]: ids.walnut }, addOns: {}, customDetails: {} };
    await prisma.product.update({ where: { id: product.id }, data: { salePriceCents: 99500, saleEndsAt: new Date(Date.now() + 86_400_000) } });

    const onSale = await createConfigurationQuote({ ...customer, productId: product.id, selection });
    expect(onSale.estimatedTotalCents).toBe(99500 + 30000 + 60000);
    expect(parseSnapshot(onSale.configuration)!.sale).toEqual({ regularBasePriceCents: 120000, savingsCents: 20500 });

    await prisma.product.update({ where: { id: product.id }, data: { saleEndsAt: new Date(Date.now() - 1000) } });
    const after = await createConfigurationQuote({ ...customer, productId: product.id, selection });
    expect(after.estimatedTotalCents).toBe(120000 + 30000 + 60000);
    expect(parseSnapshot(after.configuration)!.sale).toBeNull();
    // The earlier quote keeps the price the customer was shown.
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: onSale.id } })).estimatedTotalCents).toBe(189500);
  });
});
