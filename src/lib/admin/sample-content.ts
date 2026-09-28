import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { deleteMedia } from "@/lib/media/service";

/**
 * Seeded demonstration content (isSample = true) can be removed in one step
 * from the dashboard before launch.
 *
 * Structure (categories, option groups/values, add-ons, FAQs, pages) is real
 * and always kept. Only sample products, sample portfolio projects and sample
 * images that are no longer used anywhere are removed.
 */

export interface SampleContentSummary {
  products: number;
  portfolio: number;
  media: number;
}

export async function getSampleContentSummary(): Promise<SampleContentSummary> {
  const [products, portfolio, media] = await Promise.all([
    // Sample products already archived (because a quote/order references
    // them) no longer appear on the site.
    prisma.product.count({ where: { isSample: true, status: { not: "ARCHIVED" } } }),
    prisma.portfolioProject.count({ where: { isSample: true } }),
    // Images kept only because an archived sample product still shows them
    // in its (hidden) gallery aren't visible on the site either.
    prisma.media.count({ where: { isSample: true, productImages: { none: { product: { status: "ARCHIVED" } } } } }),
  ]);
  return { products, portfolio, media };
}

export interface SampleRemovalReport {
  productsDeleted: number;
  /** Sample products newly archived (kept) because quote requests or orders reference them. */
  productsArchived: string[];
  portfolioDeleted: number;
  /** Image references cleared from pages, sections, categories, options, add-ons. */
  referencesCleared: number;
  mediaDeleted: number;
  /** Sample images kept because something still uses them. */
  mediaKept: Array<{ id: string; name: string; usedIn: string[] }>;
  /** Images whose storage/database deletion failed (logged). */
  mediaFailed: number;
}

export async function removeSampleContent(opts: { clearPageAndCategoryImages: boolean }): Promise<SampleRemovalReport> {
  const now = new Date();

  // 1) Products and portfolio projects — one database transaction.
  const { productsDeleted, productsArchived, portfolioDeleted } = await prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: { isSample: true },
      select: { id: true, name: true, status: true, _count: { select: { quotes: true, orderItems: true } } },
    });
    const deletable = products.filter((p) => p._count.quotes === 0 && p._count.orderItems === 0).map((p) => p.id);
    const referenced = products.filter((p) => p._count.quotes > 0 || p._count.orderItems > 0);

    // Deleting a product cascades its gallery entries, option attachments
    // and add-on attachments (the global options/add-ons stay).
    const deleted = deletable.length ? await tx.product.deleteMany({ where: { id: { in: deletable }, isSample: true } }) : { count: 0 };
    const toArchive = referenced.filter((p) => p.status !== "ARCHIVED").map((p) => p.id);
    if (toArchive.length) {
      await tx.product.updateMany({
        where: { id: { in: toArchive } },
        data: { status: "ARCHIVED", archivedAt: now, featured: false },
      });
    }
    const portfolio = await tx.portfolioProject.deleteMany({ where: { isSample: true } });
    return {
      productsDeleted: deleted.count,
      productsArchived: referenced.filter((p) => p.status !== "ARCHIVED").map((p) => p.name),
      portfolioDeleted: portfolio.count,
    };
  });

  const sampleMedia = await prisma.media.findMany({ where: { isSample: true }, select: { id: true, originalName: true } });
  const sampleIds = sampleMedia.map((m) => m.id);

  // 2) Optionally detach sample images from pages / categories / options /
  // add-ons / social images so they can be deleted too.
  let referencesCleared = 0;
  if (opts.clearPageAndCategoryImages && sampleIds.length) {
    const inIds = { in: sampleIds };
    const results = await prisma.$transaction([
      prisma.pageSection.updateMany({ where: { imageId: inIds }, data: { imageId: null } }),
      prisma.sectionItem.updateMany({ where: { imageId: inIds }, data: { imageId: null } }),
      prisma.category.updateMany({ where: { imageId: inIds }, data: { imageId: null } }),
      prisma.optionValue.updateMany({ where: { imageId: inIds }, data: { imageId: null } }),
      prisma.addOn.updateMany({ where: { imageId: inIds }, data: { imageId: null } }),
      prisma.page.updateMany({ where: { ogImageId: inIds }, data: { ogImageId: null } }),
      prisma.siteSetting.updateMany({ where: { defaultOgImageId: inIds }, data: { defaultOgImageId: null } }),
    ]);
    referencesCleared = results.reduce((sum, r) => sum + r.count, 0);
  }

  // 3) Delete sample images nobody uses any more. deleteMedia() re-checks
  // usage (getMediaUsage) and refuses while anything still references the
  // image, then removes the database row and the stored object.
  let mediaDeleted = 0;
  let mediaFailed = 0;
  const mediaKept: SampleRemovalReport["mediaKept"] = [];
  for (const m of sampleMedia) {
    try {
      const result = await deleteMedia(m.id);
      if (result.deleted) mediaDeleted++;
      else if (result.usage.length) mediaKept.push({ id: m.id, name: m.originalName, usedIn: result.usage.map((u) => u.label) });
    } catch (error) {
      mediaFailed++;
      logger.warn("Sample media not deleted", { error, mediaId: m.id });
    }
  }

  return { productsDeleted, productsArchived, portfolioDeleted, referencesCleared, mediaDeleted, mediaKept, mediaFailed };
}

export function describeRemovalReport(r: SampleRemovalReport): string {
  const parts = [
    `${r.productsDeleted} sample product${r.productsDeleted === 1 ? "" : "s"} deleted`,
    r.productsArchived.length ? `${r.productsArchived.length} archived (referenced by quotes/orders)` : null,
    `${r.portfolioDeleted} portfolio project${r.portfolioDeleted === 1 ? "" : "s"} deleted`,
    r.referencesCleared ? `${r.referencesCleared} page/category image${r.referencesCleared === 1 ? "" : "s"} cleared` : null,
    `${r.mediaDeleted} image${r.mediaDeleted === 1 ? "" : "s"} deleted`,
    r.mediaKept.length ? `${r.mediaKept.length} image${r.mediaKept.length === 1 ? "" : "s"} kept because still in use` : null,
    r.mediaFailed ? `${r.mediaFailed} image${r.mediaFailed === 1 ? "" : "s"} could not be deleted` : null,
  ];
  return parts.filter(Boolean).join(", ") + ".";
}
