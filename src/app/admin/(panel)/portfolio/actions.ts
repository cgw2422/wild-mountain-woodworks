"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { AdminError, adminAction, fd } from "@/lib/admin/action";
import { isPortfolioSlugTaken, uniquePortfolioSlug } from "@/lib/catalog/slugs";
import { revalidateSite } from "@/lib/revalidate";
import { isValidSlug, slugify } from "@/lib/slug";
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX, optText, reqText } from "@/components/admin/content/validation";

async function validateSlug(slug: string, excludeId?: string) {
  if (!isValidSlug(slug)) {
    throw new AdminError("Please correct the highlighted fields.", {
      slug: "Use lowercase letters, numbers and single hyphens only (e.g. walnut-dining-table).",
    });
  }
  if (await isPortfolioSlugTaken(slug, excludeId)) {
    throw new AdminError("Please correct the highlighted fields.", { slug: "Another project already uses this URL." });
  }
}

export const createProject = adminAction(async (admin, data: FormData) => {
  const name = reqText(160, "Give the project a name.").parse(fd.str(data, "name"));
  const manual = fd.str(data, "slug").toLowerCase();
  let slug: string;
  if (manual) {
    await validateSlug(manual);
    slug = manual;
  } else {
    slug = await uniquePortfolioSlug(slugify(name) || "project");
  }
  const last = await prisma.portfolioProject.aggregate({ _max: { displayOrder: true } });
  const project = await prisma.portfolioProject.create({
    data: { name, slug, status: "DRAFT", displayOrder: (last._max.displayOrder ?? -1) + 1 },
  });
  await logActivity("portfolio.created", `${admin.name} created portfolio project “${name}”`, {
    actorId: admin.id,
    entityType: "portfolio",
    entityId: project.id,
  });
  revalidateSite();
  return { ok: true, id: project.id, message: "Project created. Add photos and details, then publish." };
});

const projectSchema = z.object({
  name: reqText(160, "Give the project a name."),
  slug: z.string().trim().toLowerCase().min(1, "A URL slug is required."),
  summary: z.string().trim().max(500, "Keep the summary under 500 characters."),
  description: z.string().trim().max(20000),
  furnitureType: optText(120),
  wood: optText(120),
  finish: optText(120),
  dimensions: optText(300),
  location: optText(120),
  featured: z.boolean(),
  featuredOrder: z.number().int().min(0).max(9999),
  displayOrder: z.number().int().min(0).max(99999),
  seoTitle: optText(SEO_TITLE_MAX),
  seoDescription: optText(SEO_DESCRIPTION_MAX),
});

export const updateProject = adminAction(async (admin, id: string, data: FormData) => {
  const parsed = projectSchema.parse({
    name: fd.str(data, "name"),
    slug: fd.str(data, "slug"),
    summary: fd.str(data, "summary"),
    description: typeof data.get("description") === "string" ? String(data.get("description")).trim() : "",
    furnitureType: fd.str(data, "furnitureType"),
    wood: fd.str(data, "wood"),
    finish: fd.str(data, "finish"),
    dimensions: fd.str(data, "dimensions"),
    location: fd.str(data, "location"),
    featured: fd.bool(data, "featured"),
    featuredOrder: fd.int(data, "featuredOrder", 0),
    displayOrder: fd.int(data, "displayOrder", 0),
    seoTitle: fd.str(data, "seoTitle"),
    seoDescription: fd.str(data, "seoDescription"),
  });
  const existing = await prisma.portfolioProject.findUnique({ where: { id }, select: { slug: true } });
  if (!existing) throw new AdminError("This project no longer exists.");
  if (parsed.slug !== existing.slug) await validateSlug(parsed.slug, id);
  await prisma.portfolioProject.update({ where: { id }, data: parsed });
  await logActivity("portfolio.updated", `${admin.name} updated portfolio project “${parsed.name}”`, {
    actorId: admin.id,
    entityType: "portfolio",
    entityId: id,
  });
  revalidateSite();
  return { ok: true, message: parsed.slug !== existing.slug ? "Saved. The project's web address changed — update any links you've shared." : "Project saved." };
});

const galleryItem = z.object({
  mediaId: z.string().min(1).max(40),
  alt: z
    .string()
    .trim()
    .max(300)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  isPrimary: z.boolean(),
});

export const saveGallery = adminAction(async (admin, id: string, raw: unknown) => {
  const parsed = z.array(galleryItem).max(60, "A project can have at most 60 photos.").parse(raw);
  const seen = new Set<string>();
  const items = parsed.filter((i) => (seen.has(i.mediaId) ? false : (seen.add(i.mediaId), true)));
  const project = await prisma.portfolioProject.findUnique({ where: { id }, select: { name: true, status: true } });
  if (!project) throw new AdminError("This project no longer exists.");
  if (project.status === "PUBLISHED" && items.length === 0) {
    throw new AdminError("A published project needs at least one photo. Unpublish it first if you want to remove every photo.");
  }
  const found = await prisma.media.count({ where: { id: { in: items.map((i) => i.mediaId) } } });
  if (found !== items.length) throw new AdminError("One of the selected images was deleted. Reload the page and try again.");
  let primaryIndex = items.findIndex((i) => i.isPrimary);
  if (primaryIndex < 0) primaryIndex = 0;

  await prisma.$transaction([
    prisma.portfolioImage.deleteMany({ where: { projectId: id, mediaId: { notIn: items.map((i) => i.mediaId) } } }),
    ...items.map((it, index) =>
      prisma.portfolioImage.upsert({
        where: { projectId_mediaId: { projectId: id, mediaId: it.mediaId } },
        update: { alt: it.alt, sortOrder: index, isPrimary: index === primaryIndex },
        create: { projectId: id, mediaId: it.mediaId, alt: it.alt, sortOrder: index, isPrimary: index === primaryIndex },
      }),
    ),
    prisma.portfolioProject.update({ where: { id }, data: { updatedAt: new Date() } }),
  ]);
  await logActivity("portfolio.updated", `${admin.name} updated photos for “${project.name}” (${items.length})`, {
    actorId: admin.id,
    entityType: "portfolio",
    entityId: id,
  });
  revalidateSite();
  return { ok: true, message: "Photos saved." };
});

export const setProjectStatus = adminAction(async (admin, id: string, status: "DRAFT" | "PUBLISHED" | "ARCHIVED") => {
  z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).parse(status);
  const project = await prisma.portfolioProject.findUnique({ where: { id }, include: { _count: { select: { images: true } } } });
  if (!project) throw new AdminError("This project no longer exists.");
  if (status === "PUBLISHED") {
    if (project._count.images === 0) throw new AdminError("Add at least one photo before publishing.");
    if (!project.summary.trim()) throw new AdminError("Add a short summary before publishing — it's shown on the Our Work page.");
  }
  await prisma.portfolioProject.update({
    where: { id },
    data: {
      status,
      publishedAt: status === "PUBLISHED" ? (project.publishedAt ?? new Date()) : project.publishedAt,
      // Archived projects leave the homepage preview.
      ...(status === "ARCHIVED" ? { featured: false } : {}),
    },
  });
  const verb = { PUBLISHED: "published", DRAFT: project.status === "ARCHIVED" ? "restored" : "unpublished", ARCHIVED: "archived" }[status];
  const type = status === "PUBLISHED" ? "portfolio.published" : status === "ARCHIVED" ? "portfolio.archived" : project.status === "ARCHIVED" ? "portfolio.updated" : "portfolio.unpublished";
  await logActivity(type, `${admin.name} ${verb} portfolio project “${project.name}”`, { actorId: admin.id, entityType: "portfolio", entityId: id });
  revalidateSite();
  return {
    ok: true,
    message: {
      PUBLISHED: "Published — now visible on Our Work.",
      DRAFT: project.status === "ARCHIVED" ? "Restored as a draft." : "Unpublished — hidden from the site.",
      ARCHIVED: "Archived.",
    }[status],
  };
});

export const deleteProject = adminAction(async (admin, id: string) => {
  const project = await prisma.portfolioProject.findUnique({ where: { id }, select: { name: true } });
  if (!project) throw new AdminError("This project was already deleted.");
  // PortfolioImage rows cascade; the photos stay in the media library.
  await prisma.portfolioProject.delete({ where: { id } });
  await logActivity("portfolio.deleted", `${admin.name} deleted portfolio project “${project.name}”`, { actorId: admin.id, entityType: "portfolio", entityId: id });
  revalidateSite();
  return { ok: true, message: "Project deleted." };
});

export const reorderProjects = adminAction(async (admin, rawIds: string[]) => {
  const ids = z.array(z.string().min(1).max(40)).max(1000).parse(rawIds);
  await prisma.$transaction(ids.map((id, i) => prisma.portfolioProject.update({ where: { id }, data: { displayOrder: i } })));
  await logActivity("portfolio.updated", `${admin.name} reordered portfolio projects`, { actorId: admin.id, entityType: "portfolio" });
  revalidateSite();
  return { ok: true, message: "Order saved." };
});
