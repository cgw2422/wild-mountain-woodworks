import sharp from "sharp";
import { prisma } from "@/lib/db";

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

export async function resetDb() {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export async function imageFile(name = "photo.jpg", width = 64, height = 48) {
  const buf = await sharp({ create: { width, height, channels: 3, background: "#7a5a42" } }).jpeg().toBuffer();
  return new File([new Uint8Array(buf)], name, { type: "image/jpeg" });
}

/** A minimal but realistic catalog: an ACTIVE Ridge table with overrides. */
export async function seedRidge(status: "ACTIVE" | "DRAFT" | "ARCHIVED" = "ACTIVE") {
  const category = await prisma.category.create({ data: { name: "Dining Tables", slug: "dining-tables" } });
  const size = await prisma.optionGroup.create({
    data: {
      name: "Dining Table Size",
      displayName: "Size",
      values: {
        create: [
          { name: "60", displayName: "60 × 36", priceModifierCents: 0, displayOrder: 0 },
          { name: "84", displayName: "84 × 38", priceModifierCents: 30000, displayOrder: 1 },
          { name: "Custom", displayName: "Custom", priceModifierCents: 0, isCustom: true, displayOrder: 2 },
        ],
      },
    },
    include: { values: true },
  });
  const wood = await prisma.optionGroup.create({
    data: {
      name: "Wood Species",
      displayName: "Wood",
      inputType: "IMAGE",
      values: {
        create: [
          { name: "Pine", displayName: "Pine", priceModifierCents: 0, displayOrder: 0 },
          { name: "Walnut", displayName: "Walnut", priceModifierCents: 80000, displayOrder: 1 },
        ],
      },
    },
    include: { values: true },
  });
  const bench = await prisma.addOn.create({ data: { name: "Matching Bench", priceCents: 35000, maxQuantity: 2 } });
  const v = (g: typeof size, n: string) => g.values.find((x) => x.name === n)!.id;
  const product = await prisma.product.create({
    data: {
      name: "The Ridge Dining Table",
      slug: "ridge-dining-table",
      sku: "WM-RDT",
      status,
      categoryId: category.id,
      basePriceCents: 120000,
      optionGroups: {
        create: [
          { optionGroupId: size.id, displayOrder: 0 },
          {
            optionGroupId: wood.id,
            displayOrder: 1,
            // Product-level override: walnut costs less on this piece.
            valueOverrides: { create: [{ optionValueId: v(wood, "Walnut"), priceModifierOverrideCents: 60000 }] },
          },
        ],
      },
      addOns: { create: [{ addOnId: bench.id }] },
    },
  });
  return {
    category,
    product,
    ids: { size: size.id, wood: wood.id, bench: bench.id, s60: v(size, "60"), s84: v(size, "84"), sCustom: v(size, "Custom"), pine: v(wood, "Pine"), walnut: v(wood, "Walnut") },
  };
}
