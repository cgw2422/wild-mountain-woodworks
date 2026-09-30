"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { AdminError, permittedAction } from "@/lib/admin/action";
import { revalidateSite } from "@/lib/revalidate";

const idList = z.array(z.string().min(1).max(40)).max(50);

/** Set which ACTIVE products are featured on the homepage, in order. */
export const saveFeaturedProducts = permittedAction("content", async (admin, rawIds: string[]) => {
  const ids = [...new Set(idList.parse(rawIds))];
  const found = await prisma.product.findMany({ where: { id: { in: ids }, status: "ACTIVE" }, select: { id: true } });
  if (found.length !== ids.length) throw new AdminError("One of the selected products is no longer active. Reload the page and try again.");
  await prisma.$transaction([
    // Drafts/archived keep their flag so it is preserved if they're re-activated.
    prisma.product.updateMany({ where: { status: "ACTIVE", featured: true, id: { notIn: ids } }, data: { featured: false } }),
    ...ids.map((id, i) => prisma.product.update({ where: { id }, data: { featured: true, featuredOrder: i } })),
  ]);
  await logActivity("homepage.updated", `${admin.name} updated featured furniture (${ids.length} product${ids.length === 1 ? "" : "s"})`, {
    actorId: admin.id,
    entityType: "page",
    entityId: "home",
  });
  revalidateSite();
  return { ok: true, message: "Featured furniture saved — live on the homepage now." };
});

/** Set which PUBLISHED portfolio projects appear in the Our Work preview. */
export const saveFeaturedProjects = permittedAction("content", async (admin, rawIds: string[]) => {
  const ids = [...new Set(idList.parse(rawIds))];
  const found = await prisma.portfolioProject.findMany({ where: { id: { in: ids }, status: "PUBLISHED" }, select: { id: true } });
  if (found.length !== ids.length) throw new AdminError("One of the selected projects is no longer published. Reload the page and try again.");
  await prisma.$transaction([
    prisma.portfolioProject.updateMany({ where: { status: "PUBLISHED", featured: true, id: { notIn: ids } }, data: { featured: false } }),
    ...ids.map((id, i) => prisma.portfolioProject.update({ where: { id }, data: { featured: true, featuredOrder: i } })),
  ]);
  await logActivity("homepage.updated", `${admin.name} updated featured projects (${ids.length})`, {
    actorId: admin.id,
    entityType: "page",
    entityId: "home",
  });
  revalidateSite();
  return { ok: true, message: "Featured projects saved — live on the homepage now." };
});

/** Toggle Category.showOnHomepage for every (non-archived) category. */
export const saveHomepageCategories = permittedAction("content", async (admin, data: FormData) => {
  const categories = await prisma.category.findMany({ where: { archivedAt: null }, select: { id: true, showOnHomepage: true } });
  const changes = categories
    .map((c) => ({ id: c.id, show: data.get(`show-${c.id}`) === "on" }))
    .filter((c) => categories.find((x) => x.id === c.id)!.showOnHomepage !== c.show);
  if (changes.length) {
    await prisma.$transaction(changes.map((c) => prisma.category.update({ where: { id: c.id }, data: { showOnHomepage: c.show } })));
    await logActivity("homepage.updated", `${admin.name} updated homepage categories`, { actorId: admin.id, entityType: "page", entityId: "home" });
    revalidateSite();
  }
  return { ok: true, message: changes.length ? "Homepage categories saved — live now." : "No changes to save." };
});
