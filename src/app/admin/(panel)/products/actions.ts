"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { logActivity } from "@/lib/activity";
import { revalidateSite } from "@/lib/revalidate";
import { AdminError, adminAction, fd } from "@/lib/admin/action";
import { isFurnitureSlugTaken, uniqueFurnitureSlug } from "@/lib/catalog/slugs";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { isValidSlug } from "@/lib/slug";
import { cleanupVideoFiles, deleteProductVideo } from "@/lib/media/video";
import { intText, moneyText, optionalText, requiredText } from "./_lib/schemas";
import { parseSaleInput } from "./_lib/sale";
import { saleStatus } from "@/lib/pricing/sale";
import { lastSaleDay, siteDateInput } from "@/lib/site-time";
import {
  addOnsPayloadSchema,
  imagesPayloadSchema,
  optionsPayloadSchema,
  toRequiredOverride,
  type AddOnState,
  type ImageState,
  type OptionGroupState,
} from "./_lib/payloads";

type Tx = Prisma.TransactionClient;

/* ------------------------------------------------------------------------ */
/* Create                                                                    */
/* ------------------------------------------------------------------------ */

export const createProduct = adminAction(async (admin, data: FormData) => {
  const input = z
    .object({ name: requiredText(160, "Enter a product name."), categoryId: optionalText(64) })
    .parse({ name: fd.str(data, "name"), categoryId: fd.str(data, "categoryId") });
  if (input.categoryId && !(await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } }))) {
    throw new AdminError("That category no longer exists.", { categoryId: "Choose another category." });
  }
  const slug = await uniqueFurnitureSlug(input.name);
  const product = await prisma.product.create({ data: { name: input.name, categoryId: input.categoryId, slug, status: "DRAFT" } });
  await logActivity("product.created", `${admin.name} created draft product "${product.name}"`, { actorId: admin.id, entityType: "product", entityId: product.id });
  revalidateSite();
  return { ok: true, id: product.id, message: "Draft created." };
});

/* ------------------------------------------------------------------------ */
/* Save (details + options + add-ons), optionally publish                    */
/* ------------------------------------------------------------------------ */

const detailsSchema = z.object({
  name: requiredText(160, "Enter a product name."),
  categoryId: optionalText(64),
  sku: optionalText(64),
  shortDescription: z.string().trim().max(500, "Keep this under 500 characters."),
  description: z.string().trim().max(20000, "Keep this under 20,000 characters."),
  basePrice: moneyText(),
  estMaterialCost: moneyText(),
  estLaborHours: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 10000) {
        ctx.addIssue({ code: "custom", message: "Enter hours like 24 or 12.5." });
        return null;
      }
      return n;
    }),
  showPrice: z.boolean(),
  featured: z.boolean(),
  featuredOrder: intText({ min: 0, max: 9999 }),
  leadTime: optionalText(200),
  dimensions: optionalText(5000),
  materials: optionalText(5000),
  construction: optionalText(5000),
  deliveryInfo: optionalText(5000),
  careInstructions: optionalText(5000),
  seoTitle: optionalText(120),
  seoDescription: optionalText(320),
});

function parseJson<T>(raw: string, schema: z.ZodType<T>, label: string): T {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new AdminError(`The ${label} data couldn't be read. Reload the page and try again.`);
  }
  const res = schema.safeParse(json);
  if (!res.success) throw new AdminError(`The ${label} data is invalid. Reload the page and try again.`);
  return res.data;
}

function overrideCents(raw: string, where: string): number | null {
  const c = parseDollarsToCents(raw);
  if (c === null) return null;
  if (Number.isNaN(c) || Math.abs(c) > 100_000_000) throw new AdminError(`${where}: enter an amount like 150 or -50, or leave it blank to inherit.`);
  return c;
}

function overrideInt(raw: string, where: string, min: number, max: number): number | null {
  const v = raw.trim();
  if (v === "") return null;
  if (!/^-?\d+$/.test(v) || Number(v) < min || Number(v) > max) throw new AdminError(`${where}: enter a whole number between ${min} and ${max}, or leave it blank.`);
  return Number(v);
}

async function syncOptions(tx: Tx, productId: string, groups: OptionGroupState[]) {
  const ids = [...new Set(groups.map((g) => g.optionGroupId))];
  const library = await tx.optionGroup.findMany({ where: { id: { in: ids } }, include: { values: { select: { id: true, displayName: true } } } });
  const byId = new Map(library.map((g) => [g.id, g]));
  const seen = new Set<string>();

  // Validate everything before writing.
  const planned = groups
    .filter((g) => {
      if (seen.has(g.optionGroupId) || !byId.has(g.optionGroupId)) return false;
      seen.add(g.optionGroupId);
      return true;
    })
    .map((g, index) => {
      const lib = byId.get(g.optionGroupId)!;
      const valueNames = new Map(lib.values.map((v) => [v.id, v.displayName]));
      let defaultTaken = false;
      const overrides = g.values
        .filter((v) => valueNames.has(v.optionValueId))
        .map((v) => {
          const where = `${lib.name} › ${valueNames.get(v.optionValueId)}`;
          const isDefault = v.isDefault && v.enabled && !defaultTaken;
          if (isDefault) defaultTaken = true;
          return {
            optionValueId: v.optionValueId,
            enabled: v.enabled,
            priceModifierOverrideCents: overrideCents(v.priceOverride, `${where} price`),
            displayOrderOverride: overrideInt(v.displayOrderOverride, `${where} order`, -9999, 9999),
            isDefault,
          };
        })
        // Only store rows that differ from the global value (inherit otherwise).
        .filter((o) => !o.enabled || o.priceModifierOverrideCents != null || o.displayOrderOverride != null || o.isDefault);
      return {
        optionGroupId: g.optionGroupId,
        displayOrder: index,
        requiredOverride: toRequiredOverride(g.requiredOverride),
        displayNameOverride: g.displayNameOverride.trim() || null,
        overrides,
      };
    });

  await tx.productOptionGroup.deleteMany({ where: { productId, optionGroupId: { notIn: planned.map((p) => p.optionGroupId) } } });
  for (const p of planned) {
    const row = await tx.productOptionGroup.upsert({
      where: { productId_optionGroupId: { productId, optionGroupId: p.optionGroupId } },
      create: { productId, optionGroupId: p.optionGroupId, displayOrder: p.displayOrder, requiredOverride: p.requiredOverride, displayNameOverride: p.displayNameOverride },
      update: { displayOrder: p.displayOrder, requiredOverride: p.requiredOverride, displayNameOverride: p.displayNameOverride },
      select: { id: true },
    });
    await tx.productOptionValue.deleteMany({ where: { productOptionGroupId: row.id } });
    if (p.overrides.length) {
      await tx.productOptionValue.createMany({ data: p.overrides.map((o) => ({ ...o, productOptionGroupId: row.id })) });
    }
  }
}

async function syncAddOns(tx: Tx, productId: string, rows: AddOnState[]) {
  const ids = [...new Set(rows.map((r) => r.addOnId))];
  const library = await tx.addOn.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(library.map((a) => [a.id, a.name]));
  const seen = new Set<string>();
  const planned = rows
    .filter((r) => {
      if (seen.has(r.addOnId) || !names.has(r.addOnId)) return false;
      seen.add(r.addOnId);
      return true;
    })
    .map((r, index) => {
      const name = names.get(r.addOnId)!;
      const priceOverrideCents = overrideCents(r.priceOverride, `${name} price`);
      if (priceOverrideCents != null && priceOverrideCents < 0) throw new AdminError(`${name} price: the price can't be negative.`);
      const minQuantityOverride = overrideInt(r.minQuantityOverride, `${name} minimum quantity`, 0, 100);
      const maxQuantityOverride = overrideInt(r.maxQuantityOverride, `${name} maximum quantity`, 1, 100);
      if (minQuantityOverride != null && maxQuantityOverride != null && minQuantityOverride > maxQuantityOverride) {
        throw new AdminError(`${name}: the minimum quantity can't be more than the maximum.`);
      }
      return {
        addOnId: r.addOnId,
        enabled: r.enabled,
        priceOverrideCents,
        requiredOverride: toRequiredOverride(r.requiredOverride),
        minQuantityOverride,
        maxQuantityOverride,
        displayOrder: index,
      };
    });

  await tx.productAddOn.deleteMany({ where: { productId, addOnId: { notIn: planned.map((p) => p.addOnId) } } });
  for (const p of planned) {
    const { addOnId, ...rest } = p;
    await tx.productAddOn.upsert({
      where: { productId_addOnId: { productId, addOnId } },
      create: { productId, addOnId, ...rest },
      update: rest,
    });
  }
}

/** Problems that block publishing (empty array = publishable). */
async function publishProblems(productId: string) {
  const p = await prisma.product.findUnique({
    where: { id: productId },
    select: { name: true, categoryId: true, basePriceCents: true, saleEnabled: true, salePriceCents: true, _count: { select: { images: true } } },
  });
  if (!p) throw new AdminError("That product no longer exists.");
  const problems: string[] = [];
  if (saleStatus(p) === "invalid") problems.push("fix the sale price (it must be lower than the regular price) or switch the sale off");
  if (!p.name.trim()) problems.push("add a name");
  if (!p.categoryId) problems.push("choose a category");
  if (p._count.images === 0) problems.push("add at least one image");
  return { problems, noPrice: p.basePriceCents == null, name: p.name };
}

async function publish(adminId: string, adminName: string, productId: string) {
  const { problems, noPrice, name } = await publishProblems(productId);
  if (problems.length) {
    return { ok: false as const, message: `Can't publish yet — please ${problems.join(", ")}.` };
  }
  const current = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { publishedAt: true } });
  await prisma.product.update({
    where: { id: productId },
    data: { status: "ACTIVE", archivedAt: null, publishedAt: current.publishedAt ?? new Date() },
  });
  await logActivity("product.published", `${adminName} published "${name}"`, { actorId: adminId, entityType: "product", entityId: productId });
  return {
    ok: true as const,
    message: noPrice ? "Published. Note: there is no base price, so customers will see “Price on request”." : "Published — it's now live on the site.",
  };
}

export const saveProduct = adminAction(async (admin, productId: string, data: FormData) => {
  const intent = fd.str(data, "intent") === "publish" ? "publish" : "save";
  const input = detailsSchema.parse({
    name: fd.str(data, "name"),
    categoryId: fd.str(data, "categoryId"),
    sku: fd.str(data, "sku"),
    shortDescription: fd.str(data, "shortDescription"),
    description: fd.str(data, "description"),
    basePrice: fd.str(data, "basePrice"),
    estMaterialCost: fd.str(data, "estMaterialCost"),
    estLaborHours: fd.str(data, "estLaborHours"),
    showPrice: fd.bool(data, "showPrice"),
    featured: fd.bool(data, "featured"),
    featuredOrder: fd.str(data, "featuredOrder"),
    leadTime: fd.str(data, "leadTime"),
    dimensions: fd.str(data, "dimensions"),
    materials: fd.str(data, "materials"),
    construction: fd.str(data, "construction"),
    deliveryInfo: fd.str(data, "deliveryInfo"),
    careInstructions: fd.str(data, "careInstructions"),
    seoTitle: fd.str(data, "seoTitle"),
    seoDescription: fd.str(data, "seoDescription"),
  });

  const slug = fd.str(data, "slug").toLowerCase();
  if (!isValidSlug(slug)) throw new AdminError("Please correct the highlighted fields.", { slug: "Use only lowercase letters, numbers and single hyphens." });
  if (await isFurnitureSlugTaken(slug, { productId })) {
    throw new AdminError("That URL is already used by another product or category.", { slug: "Already used by another product or category (or reserved)." });
  }
  if (input.sku) {
    const clash = await prisma.product.findFirst({ where: { sku: { equals: input.sku, mode: "insensitive" }, id: { not: productId } }, select: { name: true } });
    if (clash) throw new AdminError("Please correct the highlighted fields.", { sku: `Already used by “${clash.name}”.` });
  }
  if (input.categoryId && !(await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } }))) {
    throw new AdminError("Please correct the highlighted fields.", { categoryId: "That category no longer exists." });
  }

  const hasOptions = data.has("optionsJson");
  const hasAddOns = data.has("addOnsJson");
  const options = hasOptions ? parseJson(fd.str(data, "optionsJson"), optionsPayloadSchema, "options") : null;
  const addOns = hasAddOns ? parseJson(fd.str(data, "addOnsJson"), addOnsPayloadSchema, "add-ons") : null;

  const { basePrice, estMaterialCost, featuredOrder, ...rest } = input;
  const sale = parseSaleInput({
    basePriceCents: basePrice,
    saleEnabled: fd.bool(data, "saleEnabled"),
    saleLabel: fd.str(data, "saleLabel"),
    salePrice: fd.str(data, "salePrice"),
    saleStarts: fd.str(data, "saleStarts"),
    saleEnds: fd.str(data, "saleEnds"),
  });
  const existing = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, basePriceCents: true, saleEnabled: true, saleLabel: true, salePriceCents: true, saleStartsAt: true, saleEndsAt: true },
  });
  if (!existing) throw new AdminError("That product no longer exists.");

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: productId },
      data: { ...rest, ...sale, slug, basePriceCents: basePrice, estMaterialCostCents: estMaterialCost, featuredOrder: featuredOrder ?? 0 },
    });
    if (options) await syncOptions(tx, productId, options);
    if (addOns) await syncAddOns(tx, productId, addOns);
  });
  const priceNote =
    existing && existing.basePriceCents !== basePrice
      ? ` (base price ${existing.basePriceCents == null ? "none" : formatCents(existing.basePriceCents)} → ${basePrice == null ? "none" : formatCents(basePrice)})`
      : "";
  await logActivity("product.updated", `${admin.name} updated "${input.name}"${priceNote}`, { actorId: admin.id, entityType: "product", entityId: productId });
  const saleChanged =
    existing.saleEnabled !== sale.saleEnabled ||
    existing.saleLabel !== sale.saleLabel ||
    existing.salePriceCents !== sale.salePriceCents ||
    existing.saleStartsAt?.getTime() !== sale.saleStartsAt?.getTime() ||
    existing.saleEndsAt?.getTime() !== sale.saleEndsAt?.getTime();
  if (saleChanged) {
    const describe = (s: { saleEnabled: boolean; salePriceCents: number | null; saleStartsAt: Date | null; saleEndsAt: Date | null }) =>
      s.salePriceCents == null
        ? "none"
        : `${s.saleEnabled ? "on" : "off"}, ${formatCents(s.salePriceCents)}${s.saleStartsAt ? ` from ${siteDateInput(s.saleStartsAt)}` : ""}${s.saleEndsAt ? ` through ${siteDateInput(lastSaleDay(s.saleEndsAt))}` : ""}`;
    await logActivity(
      sale.salePriceCents == null || !sale.saleEnabled ? "product.sale_removed" : "product.sale_updated",
      `${admin.name} changed the sale price of "${input.name}" (${describe(existing)} → ${describe(sale)})`,
      { actorId: admin.id, entityType: "product", entityId: productId },
    );
  }

  if (intent === "publish") {
    const res = await publish(admin.id, admin.name, productId);
    revalidateSite();
    if (!res.ok) return { ok: false, message: `Your changes were saved, but the product was not published. ${res.message}` };
    return res;
  }
  revalidateSite();
  return { ok: true, message: "Saved." };
});

/* ------------------------------------------------------------------------ */
/* Images                                                                    */
/* ------------------------------------------------------------------------ */

export const saveProductImages = adminAction(async (admin, productId: string, images: ImageState[]) => {
  const list = imagesPayloadSchema.parse(images);
  const unique = list.filter((img, i) => list.findIndex((x) => x.mediaId === img.mediaId) === i);
  const found = await prisma.media.findMany({ where: { id: { in: unique.map((i) => i.mediaId) } }, select: { id: true } });
  const existing = new Set(found.map((m) => m.id));
  const valid = unique.filter((i) => existing.has(i.mediaId));
  let primaryIndex = valid.findIndex((i) => i.isPrimary);
  if (primaryIndex < 0) primaryIndex = 0;

  const product = await prisma.product.findUnique({ where: { id: productId }, select: { name: true, status: true } });
  if (!product) throw new AdminError("That product no longer exists.");

  await prisma.$transaction(async (tx) => {
    await tx.productImage.deleteMany({ where: { productId } });
    if (valid.length) {
      await tx.productImage.createMany({
        data: valid.map((img, i) => ({
          productId,
          mediaId: img.mediaId,
          alt: img.alt.trim() || null,
          sortOrder: i,
          isPrimary: i === primaryIndex,
        })),
      });
    }
  });
  await logActivity("product.updated", `${admin.name} updated images for "${product.name}"`, { actorId: admin.id, entityType: "product", entityId: productId });
  revalidateSite();
  const missing = unique.length - valid.length;
  return {
    ok: true,
    message: missing ? `Images saved. ${missing} image${missing === 1 ? " was" : "s were"} removed from the media library and skipped.` : undefined,
  };
});

/* ------------------------------------------------------------------------ */
/* Status changes                                                            */
/* ------------------------------------------------------------------------ */

export const unpublishProduct = adminAction(async (admin, productId: string) => {
  const p = await prisma.product.update({ where: { id: productId }, data: { status: "DRAFT" } });
  await logActivity("product.unpublished", `${admin.name} unpublished "${p.name}"`, { actorId: admin.id, entityType: "product", entityId: productId });
  revalidateSite();
  return { ok: true, message: "Unpublished — the product is now a draft and hidden from the site." };
});

export const archiveProduct = adminAction(async (admin, productId: string) => {
  const p = await prisma.product.update({ where: { id: productId }, data: { status: "ARCHIVED", archivedAt: new Date() } });
  await logActivity("product.archived", `${admin.name} archived "${p.name}"`, { actorId: admin.id, entityType: "product", entityId: productId });
  revalidateSite();
  return { ok: true, message: "Archived — hidden from the site. Quotes that reference it are kept." };
});

export const restoreProduct = adminAction(async (admin, productId: string) => {
  const p = await prisma.product.update({ where: { id: productId }, data: { status: "DRAFT", archivedAt: null } });
  await logActivity("product.updated", `${admin.name} restored "${p.name}" to draft`, { actorId: admin.id, entityType: "product", entityId: productId });
  revalidateSite();
  return { ok: true, message: "Restored as a draft." };
});

export const deleteProduct = adminAction(async (admin, productId: string) => {
  const p = await prisma.product.findUnique({ where: { id: productId }, select: { name: true, _count: { select: { quotes: true, orderItems: true } } } });
  if (!p) throw new AdminError("That product no longer exists.");
  if (p._count.quotes > 0 || p._count.orderItems > 0) {
    const parts = [
      p._count.quotes ? `${p._count.quotes} quote request${p._count.quotes === 1 ? "" : "s"}` : null,
      p._count.orderItems ? `${p._count.orderItems} order item${p._count.orderItems === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    throw new AdminError(`“${p.name}” is referenced by ${parts.join(" and ")}, so it can't be deleted. Archive it instead to hide it from the site.`);
  }
  // Product images/options/add-on attachments cascade; Media files are kept in the library.
  // Video rows cascade too; their files are removed unless a duplicate still uses them.
  const videos = await prisma.productVideo.findMany({ where: { productId }, select: { storageKey: true, posterId: true } });
  await prisma.product.delete({ where: { id: productId } });
  await cleanupVideoFiles(videos);
  await logActivity("product.deleted", `${admin.name} deleted "${p.name}"`, { actorId: admin.id, entityType: "product", entityId: productId });
  revalidateSite();
  return { ok: true, message: "Product deleted." };
});

/* ------------------------------------------------------------------------ */
/* Duplicate                                                                 */
/* ------------------------------------------------------------------------ */

export const duplicateProduct = adminAction(async (admin, productId: string) => {
  const src = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      videos: { orderBy: { sortOrder: "asc" } },
      optionGroups: { orderBy: { displayOrder: "asc" }, include: { valueOverrides: true } },
      addOns: { orderBy: { displayOrder: "asc" } },
    },
  });
  if (!src) throw new AdminError("That product no longer exists.");
  const name = `Copy of ${src.name}`.slice(0, 160);
  const slug = await uniqueFurnitureSlug(name);

  const copy = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        name,
        slug,
        sku: null,
        status: "DRAFT",
        categoryId: src.categoryId,
        shortDescription: src.shortDescription,
        description: src.description,
        basePriceCents: src.basePriceCents,
        saleEnabled: src.saleEnabled,
        saleLabel: src.saleLabel,
        salePriceCents: src.salePriceCents,
        saleStartsAt: src.saleStartsAt,
        saleEndsAt: src.saleEndsAt,
        showPrice: src.showPrice,
        featured: false,
        featuredOrder: src.featuredOrder,
        purchasable: src.purchasable,
        leadTime: src.leadTime,
        dimensions: src.dimensions,
        materials: src.materials,
        construction: src.construction,
        careInstructions: src.careInstructions,
        deliveryInfo: src.deliveryInfo,
        seoTitle: src.seoTitle,
        seoDescription: src.seoDescription,
        estMaterialCostCents: src.estMaterialCostCents,
        estLaborHours: src.estLaborHours,
        displayOrder: src.displayOrder,
        isSample: false,
        images: {
          create: src.images.map((img) => ({ mediaId: img.mediaId, alt: img.alt, sortOrder: img.sortOrder, isPrimary: img.isPrimary })),
        },
        // The copy shares the same stored files; they're only deleted once no product uses them.
        videos: {
          create: src.videos.map((v) => ({
            storageKey: v.storageKey,
            url: v.url,
            originalName: v.originalName,
            mimeType: v.mimeType,
            size: v.size,
            width: v.width,
            height: v.height,
            durationSec: v.durationSec,
            title: v.title,
            posterId: v.posterId,
            sortOrder: v.sortOrder,
            uploadedById: v.uploadedById,
          })),
        },
        addOns: {
          create: src.addOns.map((a) => ({
            addOnId: a.addOnId,
            enabled: a.enabled,
            priceOverrideCents: a.priceOverrideCents,
            requiredOverride: a.requiredOverride,
            minQuantityOverride: a.minQuantityOverride,
            maxQuantityOverride: a.maxQuantityOverride,
            displayOrder: a.displayOrder,
          })),
        },
      },
    });
    for (const og of src.optionGroups) {
      await tx.productOptionGroup.create({
        data: {
          productId: created.id,
          optionGroupId: og.optionGroupId,
          displayOrder: og.displayOrder,
          requiredOverride: og.requiredOverride,
          displayNameOverride: og.displayNameOverride,
          valueOverrides: {
            create: og.valueOverrides.map((v) => ({
              optionValueId: v.optionValueId,
              enabled: v.enabled,
              priceModifierOverrideCents: v.priceModifierOverrideCents,
              displayOrderOverride: v.displayOrderOverride,
              isDefault: v.isDefault,
            })),
          },
        },
      });
    }
    return created;
  });

  await logActivity("product.duplicated", `${admin.name} duplicated "${src.name}" as "${copy.name}"`, { actorId: admin.id, entityType: "product", entityId: copy.id });
  revalidateSite();
  return { ok: true, id: copy.id, message: "Duplicated." };
});

/* ------------------------------------------------------------------------ */
/* Videos (uploads go through /api/admin/products/[id]/videos)               */
/* ------------------------------------------------------------------------ */

export const updateProductVideoTitle = adminAction(async (admin, productId: string, videoId: string, title: string) => {
  const clean = z.string().trim().max(200, "Keep the title under 200 characters.").parse(title);
  const res = await prisma.productVideo.updateMany({ where: { id: videoId, productId }, data: { title: clean } });
  if (!res.count) throw new AdminError("That video no longer exists.");
  revalidateSite();
  return { ok: true, message: "Video title saved." };
});

export const reorderProductVideos = adminAction(async (admin, productId: string, ids: string[]) => {
  const list = z.array(z.string().max(40)).max(50).parse(ids);
  await prisma.$transaction(list.map((id, i) => prisma.productVideo.updateMany({ where: { id, productId }, data: { sortOrder: i } })));
  revalidateSite();
  return { ok: true, message: "Video order saved." };
});

export const removeProductVideo = adminAction(async (admin, productId: string, videoId: string) => {
  const row = await deleteProductVideo(videoId, productId);
  if (!row) throw new AdminError("That video no longer exists.");
  await logActivity("product.updated", `${admin.name} removed a video from a product`, { actorId: admin.id, entityType: "product", entityId: productId });
  revalidateSite();
  return { ok: true, message: "Video removed." };
});
