import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "next/headers",
  async () => (await import("../support/next-request")).nextHeaders,
);
vi.mock(
  "next/navigation",
  async () => (await import("../support/next-request")).nextNavigation,
);
vi.mock(
  "next/cache",
  async () => (await import("../support/next-request")).nextCache,
);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest } =
  await import("../support/next-request");
const {
  getCatalogProducts,
  getProductPage,
  getSaleProducts,
  countSaleProducts,
} = await import("@/lib/catalog/queries");
const { createConfigurationQuote } = await import("@/lib/services/submissions");
const { priceCart } = await import("@/lib/commerce/cart");
const { getActiveAnnouncement } = await import("@/lib/promotions/queries");
const { withDismissed, dismissKey } =
  await import("@/lib/promotions/announcement");
const promo = await import("@/app/admin/(panel)/promotions/actions");
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");

const START = new Date("2026-10-01T04:00:00Z"); // Oct 1, 00:00 New York
const END = new Date("2026-10-07T04:00:00Z"); // after Oct 6
const BEFORE = new Date("2026-09-30T12:00:00Z");
const DURING = new Date("2026-10-03T12:00:00Z");
const AFTER = new Date("2026-10-07T04:00:01Z");

function at(when: Date) {
  vi.setSystemTime(when);
}

describe.skipIf(!hasTestDb)("scheduled sales and announcements", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await resetDb();
    await prisma.siteSetting.create({ data: { id: "default" } });
    resetRequest();
  });
  afterEach(() => vi.useRealTimers());

  async function scheduledSale() {
    const seeded = await seedRidge();
    await prisma.product.update({
      where: { id: seeded.product.id },
      data: {
        saleEnabled: true,
        salePriceCents: 84000,
        saleStartsAt: START,
        saleEndsAt: END,
        saleLabel: "Fall Sale",
      },
    });
    return seeded;
  }

  it("shows the sale only inside its window: cards, product page, sale page, structured data", async () => {
    await scheduledSale();

    at(BEFORE);
    let [card] = await getCatalogProducts();
    expect(card).toMatchObject({
      startingPriceCents: 120000,
      regularPriceCents: null,
      sale: null,
    });
    expect(await getSaleProducts(BEFORE)).toHaveLength(0);
    expect(
      (await getProductPage({ slug: "ridge-dining-table" }))!
        .startingPriceCents,
    ).toBe(120000);

    at(DURING);
    [card] = await getCatalogProducts();
    expect(card).toMatchObject({
      startingPriceCents: 84000,
      regularPriceCents: 120000,
      sale: { label: "Fall Sale", percentOff: 30 },
    });
    const sale = await getSaleProducts(DURING);
    expect(sale.map((p) => p.slug)).toEqual(["ridge-dining-table"]);
    expect(await countSaleProducts()).toBe(1);
    const page = (await getProductPage({ slug: "ridge-dining-table" }))!;
    // Structured data uses startingPriceCents (the active price) + saleEndsAt.
    expect(page).toMatchObject({
      startingPriceCents: 84000,
      regularPriceCents: 120000,
      saleEndsAt: END.toISOString(),
    });

    at(AFTER);
    [card] = await getCatalogProducts();
    expect(card).toMatchObject({
      startingPriceCents: 120000,
      regularPriceCents: null,
      sale: null,
    });
    expect(await getSaleProducts(AFTER)).toHaveLength(0);
    const after = (await getProductPage({ slug: "ridge-dining-table" }))!;
    expect(after).toMatchObject({
      startingPriceCents: 120000,
      regularPriceCents: null,
      saleEndsAt: null,
      sale: null,
    });
  });

  it("hides sales where prices are hidden, and when switched off", async () => {
    const { product } = await scheduledSale();
    at(DURING);
    await prisma.product.update({
      where: { id: product.id },
      data: { showPrice: false },
    });
    expect(await getSaleProducts(DURING)).toHaveLength(0);
    expect((await getCatalogProducts())[0]!.sale).toBeNull();
    await prisma.product.update({
      where: { id: product.id },
      data: { showPrice: true, saleEnabled: false },
    });
    expect(await getSaleProducts(DURING)).toHaveLength(0);
    // A stale sale that isn't below the regular price never shows.
    await prisma.product.update({
      where: { id: product.id },
      data: { saleEnabled: true, basePriceCents: 80000 },
    });
    expect(await getSaleProducts(DURING)).toHaveLength(0);
    expect((await getCatalogProducts())[0]!.sale).toBeNull();
  });

  it("prices quotes and a future cart server-side at the price active at that moment", async () => {
    const { product, ids } = await scheduledSale();
    const selection = {
      options: { [ids.size]: ids.s60, [ids.wood]: ids.pine },
      addOns: {},
      customDetails: {},
    };
    const customer = {
      name: "Pat",
      email: "pat@example.com",
      phone: null,
      zipCode: "43215",
      timeline: null,
      notes: "",
    };

    at(BEFORE);
    expect(
      (
        await createConfigurationQuote({
          ...customer,
          productId: product.id,
          selection,
        })
      ).estimatedTotalCents,
    ).toBe(120000);
    at(DURING);
    expect(
      (
        await createConfigurationQuote({
          ...customer,
          productId: product.id,
          selection,
        })
      ).estimatedTotalCents,
    ).toBe(84000);
    // The cart has no price field at all: a browser-sent price can't be used.
    const tampered = {
      productId: product.id,
      selection,
      quantity: 1,
      unitPriceCents: 1,
    } as Parameters<typeof priceCart>[0][number];
    const cart = await priceCart([tampered]);
    expect(cart.subtotalCents).toBe(84000);
    expect(cart.lines[0]!.snapshot.sale).toMatchObject({
      regularBasePriceCents: 120000,
      savingsCents: 36000,
    });
    at(AFTER);
    expect((await priceCart([tampered])).subtotalCents).toBe(120000);
  });

  it("shows the announcement on schedule, honours dismissal, and re-shows new wording", async () => {
    const a = await prisma.announcement.create({
      data: {
        name: "Fall",
        enabled: true,
        message: "Fall Sale — Up to 30% Off Select Furniture",
        linkUrl: "/furniture/sale",
        startsAt: START,
        endsAt: END,
      },
    });
    expect(await getActiveAnnouncement(BEFORE, null)).toBeNull();
    const live = await getActiveAnnouncement(DURING, null);
    expect(live).toMatchObject({
      message: "Fall Sale — Up to 30% Off Select Furniture",
      linkUrl: "/furniture/sale",
      endsLabel: "Ends October 6",
    });
    expect(await getActiveAnnouncement(AFTER, null)).toBeNull();

    const dismissed = withDismissed(null, live!.key);
    expect(await getActiveAnnouncement(DURING, dismissed)).toBeNull();

    // Rewording through admin bumps the revision: it shows again.
    at(DURING);
    await createSignedInAdmin();
    const form = new FormData();
    for (const [k, v] of Object.entries({
      name: "Fall",
      enabled: "on",
      message: "Fall Sale — Now Up to 35% Off",
      linkUrl: "/furniture/sale",
      backgroundColor: "#1f1e1c",
      textColor: "#f7f3ec",
      startsAt: "2026-10-01T00:00",
      endsAt: "2026-10-07T00:00",
      showEndDate: "on",
      dismissible: "on",
      showOnDesktop: "on",
      showOnMobile: "on",
    }))
      form.set(k, v);
    expect((await promo.saveAnnouncement(a.id, form)).ok).toBe(true);
    const saved = await prisma.announcement.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(saved.revision).toBe(2);
    expect(saved.startsAt!.toISOString()).toBe(START.toISOString());
    expect(saved.endsAt!.toISOString()).toBe(END.toISOString());
    expect((await getActiveAnnouncement(DURING, dismissed))?.key).toBe(
      dismissKey(saved),
    );

    // Saving without changing the wording keeps visitors' dismissal.
    expect((await promo.saveAnnouncement(a.id, form)).ok).toBe(true);
    expect(
      (await prisma.announcement.findUniqueOrThrow({ where: { id: a.id } }))
        .revision,
    ).toBe(2);
  });

  it("validates announcements server-side and requires an admin", async () => {
    const a = await prisma.announcement.create({
      data: { name: "X", message: "Hello" },
    });
    const base = {
      name: "X",
      message: "Hello",
      backgroundColor: "#1f1e1c",
      textColor: "#f7f3ec",
      showOnDesktop: "on",
      showOnMobile: "on",
    };
    const make = (extra: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ ...base, ...extra })) f.set(k, v);
      return f;
    };
    await expect(
      promo.saveAnnouncement(a.id, make({ message: "Hacked" })),
    ).rejects.toThrow();

    await createSignedInAdmin();
    expect(
      await promo.saveAnnouncement(
        a.id,
        make({ linkUrl: "javascript:alert(1)" }),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { linkUrl: expect.any(String) },
    });
    expect(
      await promo.saveAnnouncement(a.id, make({ textColor: "#2a2926" })),
    ).toMatchObject({
      ok: false,
      fieldErrors: { textColor: expect.any(String) },
    });
    expect(
      await promo.saveAnnouncement(
        a.id,
        make({ startsAt: "2026-10-07T00:00", endsAt: "2026-10-01T00:00" }),
      ),
    ).toMatchObject({ ok: false, fieldErrors: { endsAt: expect.any(String) } });
    expect(
      await promo.saveAnnouncement(
        a.id,
        make({ enabled: "on", showOnDesktop: "", showOnMobile: "" }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      await promo.saveAnnouncement(a.id, make({ message: "" })),
    ).toMatchObject({
      ok: false,
      fieldErrors: { message: expect.any(String) },
    });
    expect(
      (await prisma.announcement.findUniqueOrThrow({ where: { id: a.id } }))
        .message,
    ).toBe("Hello");

    // Device visibility: hidden on both never renders.
    await prisma.announcement.update({
      where: { id: a.id },
      data: { enabled: true, showOnDesktop: false, showOnMobile: false },
    });
    expect(await getActiveAnnouncement(new Date(), null)).toBeNull();
  });
});
