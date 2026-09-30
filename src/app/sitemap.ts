import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { PAGE_DEFINITIONS, POLICY_SLUGS, getPageDefinition } from "@/lib/cms/definitions";
import { countSaleProducts, publicCategoryWhere, publicProductWhere } from "@/lib/catalog/queries";
import { siteUrl } from "@/lib/site-url";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPaths = ["/", "/furniture", "/our-work", "/custom-furniture", "/about", "/faq", "/contact", "/request-quote"];
  // Only PUBLISHED pages: drafted/archived pages (and never /cart or /checkout) stay out.
  const statusSlugs = PAGE_DEFINITIONS.filter((d) => d.kind === "system" && d.statusControl).map((d) => d.slug);
  try {
    const [products, categories, projects, policies, saleCount] = await Promise.all([
      prisma.product.findMany({ where: publicProductWhere, select: { slug: true, updatedAt: true } }),
      prisma.category.findMany({ where: { ...publicCategoryWhere, linkUrl: null }, select: { slug: true, updatedAt: true } }),
      prisma.portfolioProject.findMany({ where: { status: "PUBLISHED" }, select: { slug: true, updatedAt: true } }),
      prisma.page.findMany({
        where: { status: "PUBLISHED", OR: [{ slug: { in: POLICY_SLUGS } }, { isCustom: true }] },
        select: { slug: true, updatedAt: true },
      }),
      countSaleProducts(),
    ]);
    const unpublished = new Set(
      (await prisma.page.findMany({ where: { slug: { in: statusSlugs }, status: { not: "PUBLISHED" } }, select: { slug: true } })).map(
        (p) => getPageDefinition(p.slug)!.path,
      ),
    );
    return [
      ...staticPaths.filter((p) => !unpublished.has(p)).map((p) => ({ url: siteUrl(p), changeFrequency: "weekly" as const, priority: p === "/" ? 1 : 0.8 })),
      // Only while something is on sale.
      ...(saleCount > 0 ? [{ url: siteUrl("/furniture/sale"), changeFrequency: "daily" as const, priority: 0.7 }] : []),
      ...categories.map((c) => ({ url: siteUrl(`/furniture/${c.slug}`), lastModified: c.updatedAt, priority: 0.8 })),
      ...products.map((p) => ({ url: siteUrl(`/furniture/${p.slug}`), lastModified: p.updatedAt, priority: 0.9 })),
      ...projects.map((p) => ({ url: siteUrl(`/our-work/${p.slug}`), lastModified: p.updatedAt, priority: 0.6 })),
      ...policies.map((p) => ({ url: siteUrl(`/${p.slug}`), lastModified: p.updatedAt, priority: 0.3 })),
    ];
  } catch (error) {
    logger.error("Sitemap generation failed", { error });
    return staticPaths.map((p) => ({ url: siteUrl(p) }));
  }
}
