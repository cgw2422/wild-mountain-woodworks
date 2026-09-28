"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { revalidateSite } from "@/lib/revalidate";
import { AdminError, adminAction, fd } from "@/lib/admin/action";
import { isFurnitureSlugTaken, uniqueFurnitureSlug } from "@/lib/catalog/slugs";
import { isValidSlug } from "@/lib/slug";
import { idList, linkUrlText, optionalText, requiredText } from "../products/_lib/schemas";

const categorySchema = z.object({
  name: requiredText(120, "Enter a category name."),
  description: optionalText(2000),
  imageId: optionalText(64),
  linkUrl: linkUrlText,
  seoTitle: optionalText(120),
  seoDescription: optionalText(320),
  visible: z.boolean(),
  showOnHomepage: z.boolean(),
});

function readCategory(data: FormData) {
  return categorySchema.parse({
    name: fd.str(data, "name"),
    description: fd.str(data, "description"),
    imageId: fd.str(data, "imageId"),
    linkUrl: fd.str(data, "linkUrl"),
    seoTitle: fd.str(data, "seoTitle"),
    seoDescription: fd.str(data, "seoDescription"),
    visible: fd.bool(data, "visible"),
    showOnHomepage: fd.bool(data, "showOnHomepage"),
  });
}

export const createCategory = adminAction(async (admin, data: FormData) => {
  const input = readCategory(data);
  const slug = await uniqueFurnitureSlug(input.name);
  const last = await prisma.category.aggregate({ _max: { displayOrder: true } });
  const category = await prisma.category.create({
    data: { ...input, slug, displayOrder: (last._max.displayOrder ?? -1) + 1 },
  });
  await logActivity("category.updated", `${admin.name} created category "${category.name}"`, { actorId: admin.id, entityType: "category", entityId: category.id });
  revalidateSite();
  return { ok: true, id: category.id, message: "Category created." };
});

export const updateCategory = adminAction(async (admin, id: string, data: FormData) => {
  const input = readCategory(data);
  const slug = fd.str(data, "slug").toLowerCase();
  if (!isValidSlug(slug)) throw new AdminError("Please correct the highlighted fields.", { slug: "Use only lowercase letters, numbers and single hyphens." });
  if (await isFurnitureSlugTaken(slug, { categoryId: id })) {
    throw new AdminError("That URL is already used by another product or category.", { slug: "Already used by another product or category (or reserved)." });
  }
  const existing = await prisma.category.findUnique({ where: { id }, select: { archivedAt: true } });
  if (!existing) throw new AdminError("That category no longer exists.");
  // Archived categories stay hidden until restored.
  const category = await prisma.category.update({
    where: { id },
    data: { ...input, slug, visible: existing.archivedAt ? false : input.visible },
  });
  await logActivity("category.updated", `${admin.name} updated category "${category.name}"`, { actorId: admin.id, entityType: "category", entityId: id });
  revalidateSite();
  return { ok: true, message: "Category saved." };
});

export const reorderCategories = adminAction(async (admin, ids: string[]) => {
  const list = idList.parse(ids);
  await prisma.$transaction(list.map((id, i) => prisma.category.update({ where: { id }, data: { displayOrder: i } })));
  await logActivity("category.updated", `${admin.name} reordered categories`, { actorId: admin.id, entityType: "category" });
  revalidateSite();
  return { ok: true, message: "Category order saved." };
});

export const archiveCategory = adminAction(async (admin, id: string) => {
  const c = await prisma.category.update({ where: { id }, data: { archivedAt: new Date(), visible: false, showOnHomepage: false } });
  await logActivity("category.updated", `${admin.name} archived category "${c.name}"`, { actorId: admin.id, entityType: "category", entityId: id });
  revalidateSite();
  return { ok: true, message: "Category archived and hidden from the site." };
});

export const restoreCategory = adminAction(async (admin, id: string) => {
  const c = await prisma.category.update({ where: { id }, data: { archivedAt: null } });
  await logActivity("category.updated", `${admin.name} restored category "${c.name}"`, { actorId: admin.id, entityType: "category", entityId: id });
  revalidateSite();
  return { ok: true, message: "Restored. It is still hidden — turn on “Visible” when it's ready." };
});

export const deleteCategory = adminAction(async (admin, id: string) => {
  const c = await prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
  if (!c) throw new AdminError("That category no longer exists.");
  if (c._count.products > 0) {
    throw new AdminError(
      `“${c.name}” is used by ${c._count.products} product${c._count.products === 1 ? "" : "s"}. Move those products to another category first, or archive this category instead.`,
    );
  }
  await prisma.category.delete({ where: { id } });
  await logActivity("category.updated", `${admin.name} deleted category "${c.name}"`, { actorId: admin.id, entityType: "category", entityId: id });
  revalidateSite();
  return { ok: true, message: "Category deleted." };
});
