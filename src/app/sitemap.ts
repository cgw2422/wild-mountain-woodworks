import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { PAGE_DEFINITIONS, canChangeStatus } from "@/lib/cms/definitions";
import { countSaleProducts, publicCategoryWhere, publicProductWhere } from "@/lib/catalog/queries";
import { siteUrl } from "@/lib/site-url";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Lower priority for legal/help pages than for the main sections. */
function priorityFor(path: string, kind: string) {
  if (path === "/") return 1;
  return kind === "policy" ? 0.3 : 0.8;
}

/**
 * Only PUBLISHED pages: every Draft or Archived page (code-defined or
 * created in admin) is left out automatically. Templates (product/project
 * content blocks) have no URL of their own. Customer quote/invoice/order
 * links and admin routes are never listed.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pageDefs = PAGE_DEFINITIONS.filter((d) => !d.template);
  try {
    const [rows, products, categories, projects, saleCount] = await Promise.all([
      prisma.page.findMany({ select: { slug: true, status: true, isCustom: true, updatedAt: true } }),
      prisma.product.findMany({ where: publicProductWhere, select: { slug: true, updatedAt: true } }),
      prisma.category.findMany({ where: { ...publicCategoryWhere, linkUrl: null }, select: { slug: true, updatedAt: true } }),
      prisma.portfolioProject.findMany({ where: { status: "PUBLISHED" }, select: { slug: true, updatedAt: true } }),
      countSaleProducts(),
    ]);
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    const codePages = pageDefs
      .filter((d) => {
        const row = bySlug.get(d.slug);
        // A page row that doesn't exist yet is created published by the deploy seed.
        if (canChangeStatus(d) && row && row.status !== "PUBLISHED") return false;
        // The sale collection is only listed while something is on sale.
        return d.slug !== "sale" || saleCount > 0;
      })
      .map((d) => ({ url: siteUrl(d.path), lastModified: bySlug.get(d.slug)?.updatedAt, priority: priorityFor(d.path, d.kind) }));
    const customPages = rows.filter((r) => r.isCustom && r.status === "PUBLISHED").map((r) => ({ url: siteUrl(`/${r.slug}`), lastModified: r.updatedAt, priority: 0.5 }));
    return [
      ...codePages,
      ...customPages,
      ...categories.map((c) => ({ url: siteUrl(`/furniture/${c.slug}`), lastModified: c.updatedAt, priority: 0.8 })),
      ...products.map((p) => ({ url: siteUrl(`/furniture/${p.slug}`), lastModified: p.updatedAt, priority: 0.9 })),
      ...projects.map((p) => ({ url: siteUrl(`/our-work/${p.slug}`), lastModified: p.updatedAt, priority: 0.6 })),
    ];
  } catch (error) {
    logger.error("Sitemap generation failed", { error });
    return [{ url: siteUrl("/") }];
  }
}
