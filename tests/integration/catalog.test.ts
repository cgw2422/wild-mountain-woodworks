import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getCatalogProducts, getProductPage, getPublicCategoryBySlug } from "@/lib/catalog/queries";
import { isFurnitureSlugTaken, uniqueFurnitureSlug } from "@/lib/catalog/slugs";
import { hasTestDb, resetDb, seedRidge } from "../support/db";

describe.skipIf(!hasTestDb)("public catalog visibility (archive behavior)", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.siteSetting.create({ data: { id: "default" } });
  });

  it("only exposes ACTIVE products; drafts and archived pieces are hidden but preserved", async () => {
    const { product, category } = await seedRidge("ACTIVE");
    await prisma.product.create({ data: { name: "Draft Bench", slug: "draft-bench", status: "DRAFT", categoryId: category.id } });
    await prisma.product.create({ data: { name: "Old Console", slug: "old-console", status: "ARCHIVED", archivedAt: new Date() } });

    expect((await getCatalogProducts()).map((p) => p.slug)).toEqual(["ridge-dining-table"]);
    expect(await getProductPage({ slug: "draft-bench" })).toBeNull();
    expect(await getProductPage({ slug: "old-console" })).toBeNull();
    // Admin preview can still see them.
    expect(await getProductPage({ slug: "draft-bench" }, true)).not.toBeNull();

    await prisma.product.update({ where: { id: product.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    expect(await getCatalogProducts()).toEqual([]);
    expect(await prisma.product.count()).toBe(3);
  });

  it("hides products and listings of hidden or archived categories", async () => {
    const { category } = await seedRidge("ACTIVE");
    await prisma.category.update({ where: { id: category.id }, data: { visible: false } });
    expect(await getCatalogProducts()).toEqual([]);
    expect(await getPublicCategoryBySlug("dining-tables")).toBeNull();
  });

  it("hides prices when disabled globally or per product", async () => {
    const { product } = await seedRidge("ACTIVE");
    expect((await getCatalogProducts())[0]!.startingPriceCents).toBe(120000);
    await prisma.product.update({ where: { id: product.id }, data: { showPrice: false } });
    expect((await getCatalogProducts())[0]!.startingPriceCents).toBeNull();
  });

  it("keeps product and category slugs unique across the shared /furniture namespace", async () => {
    const { product, category } = await seedRidge("ACTIVE");
    expect(await isFurnitureSlugTaken("dining-tables")).toBe(true);
    expect(await isFurnitureSlugTaken("ridge-dining-table")).toBe(true);
    expect(await isFurnitureSlugTaken("ridge-dining-table", { productId: product.id })).toBe(false);
    expect(await isFurnitureSlugTaken("dining-tables", { categoryId: category.id })).toBe(false);
    expect(await isFurnitureSlugTaken("preview")).toBe(true);
    expect(await uniqueFurnitureSlug("Dining Tables")).toBe("dining-tables-2");
  });
});
