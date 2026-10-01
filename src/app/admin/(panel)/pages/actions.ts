"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { AdminError, permittedAction, fd } from "@/lib/admin/action";
import { CUSTOM_PAGE_SECTIONS, RESERVED_PAGE_SLUGS, canChangeStatus, type PageDefinition } from "@/lib/cms/definitions";
import { resolvePageDefinition } from "@/lib/cms/pages";
import { isValidSlug, slugify } from "@/lib/slug";
import { revalidateSite } from "@/lib/revalidate";
import type { Prisma } from "@/generated/prisma/client";
import {
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  isSafeHref,
  optHref,
  optMediaId,
  optText,
  reqText,
} from "@/components/admin/content/validation";

async function requireDefinition(slug: string): Promise<PageDefinition> {
  const def = await resolvePageDefinition(slug);
  if (!def) throw new AdminError("That page no longer exists.");
  return def;
}

/** Page rows may not exist yet for newly defined pages — create on first save. */
async function ensurePage(tx: Prisma.TransactionClient, def: PageDefinition) {
  return tx.page.upsert({
    where: { slug: def.slug },
    update: {},
    create: { slug: def.slug, title: def.title, status: "PUBLISHED", publishedAt: new Date() },
  });
}

/** Record who last edited a page. */
async function touch(slug: string, adminId: string) {
  await prisma.page.updateMany({ where: { slug }, data: { updatedById: adminId } });
}

async function assertMediaExists(ids: Array<string | null | undefined>) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return;
  const found = await prisma.media.count({ where: { id: { in: wanted } } });
  if (found !== wanted.length) throw new AdminError("One of the selected images was deleted. Please choose another image.");
}

async function logPage(def: PageDefinition, actor: { id: string; name: string }, what: string) {
  const isHome = def.slug === "home";
  await logActivity(isHome ? "homepage.updated" : "page.updated", `${actor.name} updated ${isHome ? "the homepage" : def.title}: ${what}`, {
    actorId: actor.id,
    entityType: "page",
    entityId: def.slug,
  });
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

const itemSchema = z.object({
  id: z.string().max(60),
  eyebrow: optText(120),
  title: optText(200),
  body: optText(2000),
  imageId: optMediaId,
  linkLabel: optText(60),
  linkHref: z.string().trim().max(500).nullable().optional(),
  visible: z.boolean().default(true),
});

export const saveSection = permittedAction("content", async (admin, slug: string, key: string, data: FormData) => {
  const def = await requireDefinition(slug);
  const sdef = def.sections.find((s) => s.key === key);
  if (!sdef) throw new AdminError("That section no longer exists on this page.");
  const has = (f: (typeof sdef.fields)[number]) => sdef.fields.includes(f);

  const parsed = z
    .object({
      eyebrow: optText(120),
      heading: optText(200),
      subheading: optText(400),
      body: optText(5000),
      imageId: optMediaId,
      primaryCtaLabel: optText(60),
      primaryCtaHref: optHref,
      secondaryCtaLabel: optText(60),
      secondaryCtaHref: optHref,
    })
    .parse({
      eyebrow: fd.str(data, "eyebrow"),
      heading: fd.str(data, "heading"),
      subheading: fd.str(data, "subheading"),
      body: fd.str(data, "body"),
      imageId: fd.str(data, "imageId"),
      primaryCtaLabel: fd.str(data, "primaryCtaLabel"),
      primaryCtaHref: fd.str(data, "primaryCtaHref"),
      secondaryCtaLabel: fd.str(data, "secondaryCtaLabel"),
      secondaryCtaHref: fd.str(data, "secondaryCtaHref"),
    });

  const errors: Record<string, string> = {};
  for (const p of ["primaryCta", "secondaryCta"] as const) {
    if (!has(p)) continue;
    const label = parsed[`${p}Label`];
    const href = parsed[`${p}Href`];
    if (label && !href) errors[`${p}Href`] = "Add a destination, or clear the label to hide the button.";
    if (href && !label) errors[`${p}Label`] = "Add a button label, or clear the destination to hide the button.";
  }

  // Only the fields this section defines are written; others are untouched.
  const fields: Prisma.PageSectionUncheckedUpdateInput = {};
  if (sdef.hideable) fields.visible = fd.bool(data, "visible");
  if (has("eyebrow")) fields.eyebrow = parsed.eyebrow;
  if (has("heading")) fields.heading = parsed.heading;
  if (has("subheading")) fields.subheading = parsed.subheading;
  if (has("body")) fields.body = parsed.body;
  if (has("image")) fields.imageId = parsed.imageId;
  if (has("primaryCta")) {
    fields.primaryCtaLabel = parsed.primaryCtaLabel;
    fields.primaryCtaHref = parsed.primaryCtaHref;
  }
  if (has("secondaryCta")) {
    fields.secondaryCtaLabel = parsed.secondaryCtaLabel;
    fields.secondaryCtaHref = parsed.secondaryCtaHref;
  }

  // Repeatable items
  let items: z.infer<typeof itemSchema>[] | null = null;
  if (sdef.items) {
    let raw: unknown = [];
    try {
      raw = JSON.parse(fd.str(data, "items") || "[]");
    } catch {
      throw new AdminError("The list of items could not be read. Please reload and try again.");
    }
    const res = z.array(itemSchema).safeParse(raw);
    if (!res.success) throw new AdminError("One of the items has invalid content — check lengths and try again.");
    items = res.data;
    if (sdef.items.max != null && items.length > sdef.items.max) {
      throw new AdminError(`This section allows at most ${sdef.items.max} ${sdef.items.label.toLowerCase()}s.`);
    }
    items.forEach((it) => {
      const href = it.linkHref?.trim() || null;
      if (href && !isSafeHref(href)) errors[`item-linkHref-${it.id}`] = "Use a page path like /our-work or a full https:// URL.";
      if (it.linkLabel && !href && sdef.items!.fields.includes("link")) errors[`item-linkHref-${it.id}`] = "Add a destination or clear the link label.";
    });
  }

  if (Object.keys(errors).length) throw new AdminError("Please correct the highlighted fields.", errors);

  await assertMediaExists([has("image") ? parsed.imageId : null, ...(items ?? []).map((i) => i.imageId)]);

  const displayOrder = def.sections.findIndex((s) => s.key === key);

  await prisma.$transaction(async (tx) => {
    const page = await ensurePage(tx, def);
    const section = await tx.pageSection.upsert({
      where: { pageId_key: { pageId: page.id, key } },
      update: fields,
      create: { ...(fields as Prisma.PageSectionUncheckedCreateInput), pageId: page.id, key, displayOrder },
    });
    if (items) {
      const existing = await tx.sectionItem.findMany({ where: { sectionId: section.id }, select: { id: true } });
      const existingIds = new Set(existing.map((e) => e.id));
      const keep = new Set(items.filter((i) => existingIds.has(i.id)).map((i) => i.id));
      const toDelete = [...existingIds].filter((id) => !keep.has(id));
      if (toDelete.length) await tx.sectionItem.deleteMany({ where: { id: { in: toDelete }, sectionId: section.id } });
      for (const [index, it] of items.entries()) {
        const row = {
          eyebrow: it.eyebrow,
          title: it.title,
          body: it.body,
          imageId: it.imageId,
          linkLabel: it.linkLabel,
          linkHref: it.linkHref?.trim() || null,
          visible: it.visible,
          displayOrder: index,
        };
        if (keep.has(it.id)) await tx.sectionItem.update({ where: { id: it.id }, data: row });
        else await tx.sectionItem.create({ data: { ...row, sectionId: section.id } });
      }
      // Touch the section so "last updated" reflects item-only edits.
      await tx.pageSection.update({ where: { id: section.id }, data: { updatedAt: new Date() } });
    }
    await tx.page.update({ where: { id: page.id }, data: { updatedAt: new Date() } });
  });

  await touch(def.slug, admin.id);
  await logPage(def, admin, `${sdef.label} section`);
  revalidateSite();
  return { ok: true };
});

/* -------------------------------------------------------------------------- */
/* Page settings, body, review                                                 */
/* -------------------------------------------------------------------------- */

export const savePageSettings = permittedAction("content", async (admin, slug: string, data: FormData) => {
  const def = await requireDefinition(slug);
  const parsed = z
    .object({
      title: reqText(120, "Give the page a title."),
      navLabel: optText(40),
      seoTitle: optText(SEO_TITLE_MAX),
      seoDescription: optText(SEO_DESCRIPTION_MAX),
      ogImageId: optMediaId,
    })
    .parse({
      title: fd.str(data, "title"),
      navLabel: fd.str(data, "navLabel"),
      seoTitle: fd.str(data, "seoTitle"),
      seoDescription: fd.str(data, "seoDescription"),
      ogImageId: fd.str(data, "ogImageId"),
    });
  await assertMediaExists([parsed.ogImageId]);
  const update: Prisma.PageUncheckedUpdateInput = { ...parsed, updatedById: admin.id };

  // Only pages created in the admin can change their URL (code-defined pages have fixed routes).
  let newSlug = slug;
  if (def.kind === "custom" && data.has("slug")) {
    newSlug = fd.str(data, "slug").toLowerCase();
    if (newSlug !== slug) {
      await assertSlugAvailable(newSlug);
      update.slug = newSlug;
    }
  }
  await prisma.page.upsert({
    where: { slug },
    update,
    create: { ...(update as Prisma.PageUncheckedCreateInput), slug, status: "PUBLISHED", publishedAt: new Date() },
  });
  await logActivity("page.updated", `${admin.name} updated ${parsed.title}: page settings & SEO${newSlug !== slug ? ` (URL /${slug} → /${newSlug})` : ""}`, {
    actorId: admin.id,
    entityType: "page",
    entityId: newSlug,
  });
  revalidateSite();
  return newSlug !== slug ? { ok: true, id: newSlug, message: "Saved. The page address changed." } : { ok: true };
});

/* -------------------------------------------------------------------------- */
/* Create, status, duplicate                                                   */
/* -------------------------------------------------------------------------- */

async function assertSlugAvailable(slug: string, field = "slug") {
  if (!isValidSlug(slug)) throw new AdminError("Please correct the highlighted fields.", { [field]: "Use lowercase letters, numbers and single hyphens." });
  if (RESERVED_PAGE_SLUGS.has(slug)) throw new AdminError("Please correct the highlighted fields.", { [field]: "That address is used by another part of the site." });
  if (await prisma.page.findUnique({ where: { slug }, select: { id: true } })) {
    throw new AdminError("Please correct the highlighted fields.", { [field]: "Another page already uses this address." });
  }
}

async function freeSlug(base: string): Promise<string> {
  const root = slugify(base).slice(0, 60) || "page";
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    if (!RESERVED_PAGE_SLUGS.has(candidate) && !(await prisma.page.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
  }
  throw new AdminError("Couldn't find a free address for this page. Please enter one.");
}

/** New pages start as drafts: invisible to visitors until published. */
export const createPage = permittedAction("content", async (admin, data: FormData) => {
  const title = reqText(120, "Give the page a title.").parse(fd.str(data, "title"));
  const navLabel = optText(40).parse(fd.str(data, "navLabel"));
  const typed = fd.str(data, "slug").toLowerCase();
  const slug = typed || (await freeSlug(title));
  if (typed) await assertSlugAvailable(slug);
  await prisma.page.create({
    data: { slug, title, navLabel, isCustom: true, status: "DRAFT", createdById: admin.id, updatedById: admin.id },
  });
  await logActivity("page.created", `${admin.name} created page “${title}” (/${slug}) as a draft`, { actorId: admin.id, entityType: "page", entityId: slug });
  return { ok: true, id: slug, message: "Draft page created." };
});

const STATUS_LOG = { PUBLISHED: "page.published", DRAFT: "page.drafted", ARCHIVED: "page.archived" } as const;
const STATUS_WORD = { PUBLISHED: "published", DRAFT: "moved to draft", ARCHIVED: "archived" } as const;

type PageStatusValue = "PUBLISHED" | "DRAFT" | "ARCHIVED";

/** Change one page's status (shared by the page editor and bulk actions). Returns whether it changed. */
async function applyPageStatus(admin: { id: string; name: string }, slug: string, next: PageStatusValue): Promise<boolean> {
  const def = await requireDefinition(slug);
  if (!canChangeStatus(def)) throw new AdminError(`“${def.title}” is ${def.siteRoot ? "the homepage, which is always published" : "a shared content block, not a standalone page"}.`);
  const current = await prisma.page.findUnique({ where: { slug }, select: { status: true, title: true } });
  const before = current?.status ?? "PUBLISHED";
  if (before === next) return false;
  await prisma.page.upsert({
    where: { slug },
    update: { status: next, updatedById: admin.id, ...(next === "PUBLISHED" ? { publishedAt: new Date() } : {}) },
    create: { slug, title: def.title, status: next, updatedById: admin.id, ...(next === "PUBLISHED" ? { publishedAt: new Date() } : {}) },
  });
  const title = current?.title ?? def.title;
  await logActivity(STATUS_LOG[next], `${admin.name} ${STATUS_WORD[next]} “${title}” (${before.toLowerCase()} → ${next.toLowerCase()})`, {
    actorId: admin.id,
    entityType: "page",
    entityId: slug,
  });
  return true;
}

/**
 * Publish / move to draft / archive any standalone page. Drafted and
 * archived pages disappear from the public site, menus, breadcrumbs and
 * sitemap at once (all resolved per request) — the page, its content and
 * its menu items are kept, so republishing restores everything.
 */
export const setPageStatus = permittedAction("content", async (admin, slug: string, status: PageStatusValue) => {
  const next = z.enum(["PUBLISHED", "DRAFT", "ARCHIVED"]).parse(status);
  if (!(await applyPageStatus(admin, slug, next))) return { ok: true, message: "No change." };
  revalidateSite();
  return {
    ok: true,
    message:
      next === "PUBLISHED"
        ? "Published — it's live on the site, and its menu links are back."
        : next === "DRAFT"
          ? "Moved to draft. It's no longer visible to visitors, and it's hidden from menus and the sitemap."
          : "Archived. It's no longer visible to visitors, and it's hidden from menus and the sitemap.",
  };
});

/** Bulk publish / move to draft / archive from Admin → Pages. Pages that can't change (the homepage) are skipped. */
export const bulkSetPageStatus = permittedAction("content", async (admin, slugsArg: string[], status: PageStatusValue) => {
  const next = z.enum(["PUBLISHED", "DRAFT", "ARCHIVED"]).parse(status);
  const slugs = z.array(z.string().min(1).max(80)).min(1, "Select at least one page.").max(200).parse([...new Set(slugsArg)]);
  let changed = 0;
  const skipped: string[] = [];
  for (const slug of slugs) {
    const def = await resolvePageDefinition(slug);
    if (!def || !canChangeStatus(def)) {
      skipped.push(def?.title ?? slug);
      continue;
    }
    if (await applyPageStatus(admin, slug, next)) changed++;
  }
  revalidateSite();
  const verb = next === "PUBLISHED" ? "published" : next === "DRAFT" ? "moved to draft" : "archived";
  return { ok: true, message: `${changed} page${changed === 1 ? "" : "s"} ${verb}.${skipped.length ? ` Skipped: ${skipped.join(", ")}.` : ""}` };
});

/** Copy a created or policy page into a new draft page (content, SEO and matching sections). */
export const duplicatePage = permittedAction("content", async (admin, slug: string) => {
  const def = await requireDefinition(slug);
  if (def.kind === "system") throw new AdminError("Site pages with a fixed layout can't be duplicated. Create a new page instead.");
  const src = await prisma.page.findUnique({ where: { slug }, include: { sections: { include: { items: true } } } });
  if (!src) throw new AdminError("Save this page once before duplicating it.");
  const newSlug = await freeSlug(`${slug}-copy`);
  const keys = new Set(CUSTOM_PAGE_SECTIONS.map((s) => s.key));
  const title = `Copy of ${src.title}`.slice(0, 120);
  await prisma.page.create({
    data: {
      slug: newSlug,
      title,
      navLabel: src.navLabel,
      body: src.body,
      seoTitle: src.seoTitle,
      seoDescription: src.seoDescription,
      ogImageId: src.ogImageId,
      isCustom: true,
      status: "DRAFT",
      createdById: admin.id,
      updatedById: admin.id,
      sections: {
        create: src.sections
          .filter((sec) => keys.has(sec.key))
          .map((sec) => ({
            key: sec.key,
            visible: sec.visible,
            displayOrder: sec.displayOrder,
            eyebrow: sec.eyebrow,
            heading: sec.heading,
            subheading: sec.subheading,
            body: sec.body,
            imageId: sec.imageId,
            primaryCtaLabel: sec.primaryCtaLabel,
            primaryCtaHref: sec.primaryCtaHref,
            secondaryCtaLabel: sec.secondaryCtaLabel,
            secondaryCtaHref: sec.secondaryCtaHref,
            items: {
              create: sec.items.map((item) => ({
                eyebrow: item.eyebrow,
                title: item.title,
                body: item.body,
                imageId: item.imageId,
                linkLabel: item.linkLabel,
                linkHref: item.linkHref,
                visible: item.visible,
                displayOrder: item.displayOrder,
              })),
            },
          })),
      },
    },
  });
  await logActivity("page.created", `${admin.name} duplicated “${src.title}” as “${title}” (/${newSlug}, draft)`, {
    actorId: admin.id,
    entityType: "page",
    entityId: newSlug,
  });
  return { ok: true, id: newSlug, message: "Copied as a new draft page." };
});

export const savePageBody = permittedAction("content", async (admin, slug: string, data: FormData) => {
  const def = await requireDefinition(slug);
  if (!def.hasBody) throw new AdminError("This page has no body text.");
  const body = optText(100000).parse(typeof data.get("body") === "string" ? String(data.get("body")) : "");
  await prisma.page.upsert({
    where: { slug },
    update: { body },
    create: { slug, title: def.title, body },
  });
  await touch(def.slug, admin.id);
  await logPage(def, admin, "page text");
  revalidateSite();
});

export const markPageReviewed = permittedAction("content", async (admin, slug: string) => {
  const def = await requireDefinition(slug);
  await prisma.page.upsert({
    where: { slug },
    update: { reviewRequired: false },
    create: { slug, title: def.title, reviewRequired: false },
  });
  await touch(def.slug, admin.id);
  await logPage(def, admin, "marked as reviewed");
  revalidateSite();
  return { ok: true, message: "Marked as reviewed." };
});

export const flagPageForReview = permittedAction("content", async (admin, slug: string, data: FormData) => {
  const def = await requireDefinition(slug);
  const reviewNotes = optText(2000).parse(fd.str(data, "reviewNotes"));
  await prisma.page.upsert({
    where: { slug },
    update: { reviewRequired: true, reviewNotes },
    create: { slug, title: def.title, reviewRequired: true, reviewNotes },
  });
  await touch(def.slug, admin.id);
  await logPage(def, admin, "flagged for review");
  revalidateSite();
});
