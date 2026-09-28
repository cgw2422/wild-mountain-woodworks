import "server-only";
import { prisma } from "@/lib/db";

/** Suggestions for the custom build form, drawn from real catalog data. */
export async function getCustomFormSuggestions() {
  const [categories, woodValues, finishValues] = await Promise.all([
    prisma.category.findMany({ where: { visible: true, archivedAt: null, linkUrl: null }, orderBy: { displayOrder: "asc" }, select: { name: true } }),
    prisma.optionValue.findMany({
      where: { active: true, isCustom: false, group: { active: true, OR: [{ name: { contains: "wood", mode: "insensitive" } }, { displayName: { contains: "wood", mode: "insensitive" } }] } },
      orderBy: { displayOrder: "asc" },
      select: { displayName: true },
    }),
    prisma.optionValue.findMany({
      where: { active: true, isCustom: false, group: { active: true, OR: [{ name: { contains: "finish", mode: "insensitive" } }, { displayName: { contains: "finish", mode: "insensitive" } }] } },
      orderBy: { displayOrder: "asc" },
      select: { displayName: true },
    }),
  ]);
  const singular = (n: string) => n.replace(/ies$/, "y").replace(/(ch|sh|x)es$/, "$1").replace(/s$/, "");
  const unique = (xs: string[]) => [...new Set(xs)];
  return {
    furnitureTypes: unique([...categories.map((c) => singular(c.name)), "Other"]),
    woods: unique([...woodValues.map((v) => v.displayName), "Not sure yet"]),
    finishes: unique([...finishValues.map((v) => v.displayName), "Not sure yet"]),
  };
}
