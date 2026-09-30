import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest } = await import("../support/next-request");
const actions = await import("@/app/admin/(panel)/options/actions");
const { hasTestDb, resetDb } = await import("../support/db");

describe.skipIf(!hasTestDb)("duplicating options", () => {
  beforeEach(async () => {
    await resetDb();
    resetRequest();
    await createSignedInAdmin();
  });

  async function woodGroup() {
    const product = await prisma.product.create({ data: { name: "Ridge", slug: "ridge", status: "ACTIVE" } });
    return prisma.optionGroup.create({
      data: {
        name: "Wood Species",
        displayName: "Wood",
        inputType: "SWATCH",
        required: true,
        values: {
          create: [
            { name: "Walnut", displayName: "Walnut", swatchColor: "#5a3e2b", priceModifierCents: 30000, displayOrder: 0 },
            { name: "White Oak", displayName: "White Oak", priceModifierCents: 0, displayOrder: 1, active: false },
            { name: "Custom", displayName: "Custom species", isCustom: true, displayOrder: 2 },
          ],
        },
        products: { create: { productId: product.id } },
      },
    });
  }

  it("copies a group with every value, unattached, with a unique name", async () => {
    const src = await woodGroup();
    const res = await actions.duplicateOptionGroup(src.id);
    expect(res.ok).toBe(true);
    const copy = await prisma.optionGroup.findUniqueOrThrow({
      where: { id: res.id! },
      include: { values: { orderBy: { displayOrder: "asc" } }, _count: { select: { products: true } } },
    });
    expect(copy).toMatchObject({ name: "Copy of Wood Species", displayName: "Wood", inputType: "SWATCH", required: true });
    expect(copy._count.products).toBe(0);
    expect(copy.values.map((v) => [v.name, v.priceModifierCents, v.active, v.isCustom, v.swatchColor])).toEqual([
      ["Walnut", 30000, true, false, "#5a3e2b"],
      ["White Oak", 0, false, false, null],
      ["Custom", 0, true, true, null],
    ]);
    // The original is untouched; a second copy gets a numbered name.
    expect(await prisma.optionValue.count({ where: { groupId: src.id } })).toBe(3);
    const again = await actions.duplicateOptionGroup(src.id);
    expect((await prisma.optionGroup.findUniqueOrThrow({ where: { id: again.id! } })).name).toBe("Copy of Wood Species (2)");
  });

  it("copies a value right after the original, inactive, with a unique internal name", async () => {
    const src = await woodGroup();
    const walnut = await prisma.optionValue.findFirstOrThrow({ where: { groupId: src.id, name: "Walnut" } });
    const res = await actions.duplicateOptionValue(src.id, walnut.id);
    expect(res.ok).toBe(true);
    const values = await prisma.optionValue.findMany({ where: { groupId: src.id }, orderBy: { displayOrder: "asc" } });
    expect(values.map((v) => v.name)).toEqual(["Walnut", "Walnut (copy)", "White Oak", "Custom"]);
    expect(values[1]).toMatchObject({ displayName: "Walnut", priceModifierCents: 30000, swatchColor: "#5a3e2b", active: false });
    await actions.duplicateOptionValue(src.id, walnut.id);
    expect(await prisma.optionValue.findFirst({ where: { groupId: src.id, name: "Walnut (copy) (2)" } })).not.toBeNull();
    // A value can't be duplicated through another group's id.
    const other = await prisma.optionGroup.create({ data: { name: "Finish", displayName: "Finish" } });
    expect((await actions.duplicateOptionValue(other.id, walnut.id)).ok).toBe(false);
  });
});
