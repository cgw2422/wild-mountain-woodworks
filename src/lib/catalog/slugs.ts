import "server-only";
import { prisma } from "@/lib/db";
import { uniqueSlug } from "@/lib/slug";

/**
 * Products and categories share the /furniture/[slug] namespace, so a slug
 * must be unique across BOTH tables. Reserved words are blocked too.
 */
const RESERVED = new Set(["all", "new", "search", "cart", "checkout", "preview", "sale"]);

export async function isFurnitureSlugTaken(slug: string, exclude?: { productId?: string; categoryId?: string }) {
  if (RESERVED.has(slug)) return true;
  const [product, category] = await Promise.all([
    prisma.product.findFirst({ where: { slug, ...(exclude?.productId ? { id: { not: exclude.productId } } : {}) }, select: { id: true } }),
    prisma.category.findFirst({ where: { slug, ...(exclude?.categoryId ? { id: { not: exclude.categoryId } } : {}) }, select: { id: true } }),
  ]);
  return Boolean(product || category);
}

export function uniqueFurnitureSlug(base: string, exclude?: { productId?: string; categoryId?: string }) {
  return uniqueSlug(base, (s) => isFurnitureSlugTaken(s, exclude));
}

export async function isPortfolioSlugTaken(slug: string, excludeId?: string) {
  const hit = await prisma.portfolioProject.findFirst({ where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
  return Boolean(hit);
}

export function uniquePortfolioSlug(base: string, excludeId?: string) {
  return uniqueSlug(base, (s) => isPortfolioSlugTaken(s, excludeId));
}
