import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getStorage } from "@/lib/storage";
import { buildStorageKey, inspectImage } from "./process";
import { MEDIA_MAX_BYTES } from "./validate";

export async function createMediaFromFile(file: File, opts: { uploadedById?: string | null; alt?: string } = {}) {
  const img = await inspectImage(file, MEDIA_MAX_BYTES);
  const storage = getStorage();
  const key = buildStorageKey("media", file.name, img.extension);
  await storage.put(key, img.buffer, img.mimeType);
  try {
    return await prisma.media.create({
      data: {
        storageKey: key,
        url: storage.publicUrl(key),
        filename: key.split("/").pop()!,
        originalName: file.name.slice(0, 200),
        mimeType: img.mimeType,
        size: img.buffer.length,
        width: img.width,
        height: img.height,
        blurDataUrl: img.blurDataUrl,
        alt: opts.alt?.slice(0, 300) ?? "",
        uploadedById: opts.uploadedById ?? null,
      },
    });
  } catch (error) {
    await storage.delete(key).catch(() => undefined);
    throw error;
  }
}

/**
 * Replace the file behind an existing Media item. Every location that uses
 * it updates at once; alt text and focal point are kept.
 */
export async function replaceMediaFile(mediaId: string, file: File) {
  const existing = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!existing) throw new Error("Media not found");
  const img = await inspectImage(file, MEDIA_MAX_BYTES);
  const storage = getStorage();
  const key = buildStorageKey("media", file.name, img.extension);
  await storage.put(key, img.buffer, img.mimeType);
  const updated = await prisma.media.update({
    where: { id: mediaId },
    data: {
      storageKey: key,
      url: storage.publicUrl(key),
      filename: key.split("/").pop()!,
      originalName: file.name.slice(0, 200),
      mimeType: img.mimeType,
      size: img.buffer.length,
      width: img.width,
      height: img.height,
      blurDataUrl: img.blurDataUrl,
    },
  });
  await storage.delete(existing.storageKey).catch((error) => logger.warn("Old media object not deleted", { error }));
  return updated;
}

export interface MediaUsage {
  label: string;
  href: string;
}

/** Every place a Media item is referenced (all references are foreign keys). */
export async function getMediaUsage(mediaId: string): Promise<MediaUsage[]> {
  const [products, portfolio, categories, optionValues, addOns, sections, items, pagesOg, settings] = await Promise.all([
    prisma.productImage.findMany({ where: { mediaId }, select: { product: { select: { id: true, name: true } } } }),
    prisma.portfolioImage.findMany({ where: { mediaId }, select: { project: { select: { id: true, name: true } } } }),
    prisma.category.findMany({ where: { imageId: mediaId }, select: { id: true, name: true } }),
    prisma.optionValue.findMany({ where: { imageId: mediaId }, select: { id: true, displayName: true, groupId: true, group: { select: { displayName: true } } } }),
    prisma.addOn.findMany({ where: { imageId: mediaId }, select: { id: true, name: true } }),
    prisma.pageSection.findMany({ where: { imageId: mediaId }, select: { key: true, page: { select: { slug: true, title: true } } } }),
    prisma.sectionItem.findMany({ where: { imageId: mediaId }, select: { section: { select: { key: true, page: { select: { slug: true, title: true } } } } } }),
    prisma.page.findMany({ where: { ogImageId: mediaId }, select: { slug: true, title: true } }),
    prisma.siteSetting.count({ where: { defaultOgImageId: mediaId } }),
  ]);
  const pageHref = (slug: string) => (slug === "home" ? "/admin/homepage" : `/admin/pages/${slug}`);
  return [
    ...products.map((p) => ({ label: `Product: ${p.product.name}`, href: `/admin/products/${p.product.id}` })),
    ...portfolio.map((p) => ({ label: `Portfolio: ${p.project.name}`, href: `/admin/portfolio/${p.project.id}` })),
    ...categories.map((c) => ({ label: `Category: ${c.name}`, href: `/admin/categories/${c.id}` })),
    ...optionValues.map((v) => ({ label: `Option: ${v.group.displayName} → ${v.displayName}`, href: `/admin/options/${v.groupId}` })),
    ...addOns.map((a) => ({ label: `Add-on: ${a.name}`, href: `/admin/add-ons/${a.id}` })),
    ...sections.map((s) => ({ label: `${s.page.title} → ${s.key} section`, href: pageHref(s.page.slug) })),
    ...items.map((i) => ({ label: `${i.section.page.title} → ${i.section.key} item`, href: pageHref(i.section.page.slug) })),
    ...pagesOg.map((p) => ({ label: `${p.title} → social image`, href: pageHref(p.slug) })),
    ...(settings ? [{ label: "Settings → default social image", href: "/admin/settings" }] : []),
  ];
}

export async function getMediaUsageCounts(mediaIds: string[]): Promise<Record<string, number>> {
  if (mediaIds.length === 0) return {};
  const counts: Record<string, number> = Object.fromEntries(mediaIds.map((id) => [id, 0]));
  const add = (rows: Array<{ id: string | null; n: number }>) => {
    for (const r of rows) if (r.id && r.id in counts) counts[r.id] += r.n;
  };
  const inIds = { in: mediaIds };
  const [a, b, c, d, e, f, g, h, i] = await Promise.all([
    prisma.productImage.groupBy({ by: ["mediaId"], where: { mediaId: inIds }, _count: true }),
    prisma.portfolioImage.groupBy({ by: ["mediaId"], where: { mediaId: inIds }, _count: true }),
    prisma.category.groupBy({ by: ["imageId"], where: { imageId: inIds }, _count: true }),
    prisma.optionValue.groupBy({ by: ["imageId"], where: { imageId: inIds }, _count: true }),
    prisma.addOn.groupBy({ by: ["imageId"], where: { imageId: inIds }, _count: true }),
    prisma.pageSection.groupBy({ by: ["imageId"], where: { imageId: inIds }, _count: true }),
    prisma.sectionItem.groupBy({ by: ["imageId"], where: { imageId: inIds }, _count: true }),
    prisma.page.groupBy({ by: ["ogImageId"], where: { ogImageId: inIds }, _count: true }),
    prisma.siteSetting.groupBy({ by: ["defaultOgImageId"], where: { defaultOgImageId: inIds }, _count: true }),
  ]);
  add(a.map((r) => ({ id: r.mediaId, n: r._count })));
  add(b.map((r) => ({ id: r.mediaId, n: r._count })));
  add(c.map((r) => ({ id: r.imageId, n: r._count })));
  add(d.map((r) => ({ id: r.imageId, n: r._count })));
  add(e.map((r) => ({ id: r.imageId, n: r._count })));
  add(f.map((r) => ({ id: r.imageId, n: r._count })));
  add(g.map((r) => ({ id: r.imageId, n: r._count })));
  add(h.map((r) => ({ id: r.ogImageId, n: r._count })));
  add(i.map((r) => ({ id: r.defaultOgImageId, n: r._count })));
  return counts;
}

/**
 * Delete a Media item. Refuses when it is still in use unless `force` is set,
 * in which case references are detached first (product/portfolio gallery
 * entries are removed; single-image fields are cleared).
 */
export async function deleteMedia(mediaId: string, opts: { force?: boolean } = {}) {
  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return { deleted: false, usage: [] as MediaUsage[] };
  const usage = await getMediaUsage(mediaId);
  if (usage.length && !opts.force) return { deleted: false, usage };

  await prisma.$transaction([
    prisma.productImage.deleteMany({ where: { mediaId } }),
    prisma.portfolioImage.deleteMany({ where: { mediaId } }),
    prisma.media.delete({ where: { id: mediaId } }), // other FKs are ON DELETE SET NULL
  ]);
  await getStorage()
    .delete(media.storageKey)
    .catch((error) => logger.warn("Media object not deleted from storage", { error, key: media.storageKey }));
  return { deleted: true, usage };
}
