import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest } = await import("../support/next-request");
const Page = (await import("@/app/admin/(panel)/pricing-cheat-sheet/page")).default;
const { loadConfigurableProduct } = await import("@/lib/pricing/load");
const { buildCheatSheet, guessAxes } = await import("@/lib/pricing/cheat-sheet");
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");

describe.skipIf(!hasTestDb)("Pricing Cheat Sheet page", () => {
  let seeded: Awaited<ReturnType<typeof seedRidge>>;
  beforeEach(async () => {
    await resetDb();
    resetRequest();
    await prisma.siteSetting.create({ data: { id: "default" } });
    seeded = await seedRidge();
  });

  it("renders for admins from live data, writes nothing, and follows product changes", async () => {
    await createSignedInAdmin();
    const counts = async () => [await prisma.optionValue.count(), await prisma.quoteRequest.count(), await prisma.priceEstimate.count(), await prisma.product.count()];
    const before = await counts();
    expect(await Page({ searchParams: Promise.resolve({ product: seeded.product.id }) })).toBeTruthy();
    expect(await counts()).toEqual(before);

    // Walnut here is the product's $600 override; the grid uses it (same engine as the site).
    const sheet = () => loadConfigurableProduct({ id: seeded.product.id }).then((p) => buildCheatSheet(p!, guessAxes(p!)));
    expect((await sheet()).cells[seeded.ids.s60]![seeded.ids.walnut]!._).toMatchObject({ totalCents: 120000 + 60000 });
    // Change the product's price and remove a species: the cheat sheet follows on the next load.
    await prisma.product.update({ where: { id: seeded.product.id }, data: { basePriceCents: 130000 } });
    await prisma.optionValue.update({ where: { id: seeded.ids.walnut }, data: { active: false } });
    const after = await sheet();
    expect(after.columns.map((c) => c.label)).toEqual(["Pine"]);
    expect(after.cells[seeded.ids.s60]![seeded.ids.pine]!._!.totalCents).toBe(130000);
  });

  it("is not available to editors", async () => {
    await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(/REDIRECT \/admin\?denied=1/);
  });
});
