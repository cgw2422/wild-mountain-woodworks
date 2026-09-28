"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { AdminError, adminAction, fd } from "@/lib/admin/action";
import { getPageDefinition, type PageDefinition } from "@/lib/cms/definitions";
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

function requireDefinition(slug: string): PageDefinition {
  const def = getPageDefinition(slug);
  if (!def) throw new AdminError("That page no longer exists.");
  return def;
}

/** Page rows may not exist yet for newly defined pages — create on first save. */
async function ensurePage(tx: Prisma.TransactionClient, def: PageDefinition) {
  return tx.page.upsert({
    where: { slug: def.slug },
    update: {},
    create: { slug: def.slug, title: def.title, status: "PUBLISHED" },
  });
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

export const saveSection = adminAction(async (admin, slug: string, key: string, data: FormData) => {
  const def = requireDefinition(slug);
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

  await logPage(def, admin, `${sdef.label} section`);
  revalidateSite();
  return { ok: true };
});

/* -------------------------------------------------------------------------- */
/* Page settings, body, review                                                 */
/* -------------------------------------------------------------------------- */

export const savePageSettings = adminAction(async (admin, slug: string, data: FormData) => {
  const def = requireDefinition(slug);
  const parsed = z
    .object({
      title: reqText(120, "Give the page a title."),
      seoTitle: optText(SEO_TITLE_MAX),
      seoDescription: optText(SEO_DESCRIPTION_MAX),
      ogImageId: optMediaId,
      status: z.enum(["PUBLISHED", "DRAFT"]).optional(),
    })
    .parse({
      title: fd.str(data, "title"),
      seoTitle: fd.str(data, "seoTitle"),
      seoDescription: fd.str(data, "seoDescription"),
      ogImageId: fd.str(data, "ogImageId"),
      status: def.kind === "policy" ? fd.str(data, "status") || "PUBLISHED" : undefined,
    });
  await assertMediaExists([parsed.ogImageId]);
  const update: Prisma.PageUncheckedUpdateInput = {
    title: parsed.title,
    seoTitle: parsed.seoTitle,
    seoDescription: parsed.seoDescription,
    ogImageId: parsed.ogImageId,
    // System pages are always published; only policy pages can be drafts.
    status: def.kind === "policy" ? parsed.status : "PUBLISHED",
  };
  await prisma.page.upsert({
    where: { slug },
    update,
    create: { ...(update as Prisma.PageUncheckedCreateInput), slug },
  });
  await logPage(def, admin, def.kind === "policy" && parsed.status === "DRAFT" ? "page settings (draft)" : "page settings & SEO");
  revalidateSite();
});

export const savePageBody = adminAction(async (admin, slug: string, data: FormData) => {
  const def = requireDefinition(slug);
  if (!def.hasBody) throw new AdminError("This page has no body text.");
  const body = optText(100000).parse(typeof data.get("body") === "string" ? String(data.get("body")) : "");
  await prisma.page.upsert({
    where: { slug },
    update: { body },
    create: { slug, title: def.title, body },
  });
  await logPage(def, admin, "page text");
  revalidateSite();
});

export const markPageReviewed = adminAction(async (admin, slug: string) => {
  const def = requireDefinition(slug);
  await prisma.page.upsert({
    where: { slug },
    update: { reviewRequired: false },
    create: { slug, title: def.title, reviewRequired: false },
  });
  await logPage(def, admin, "marked as reviewed");
  revalidateSite();
  return { ok: true, message: "Marked as reviewed." };
});

export const flagPageForReview = adminAction(async (admin, slug: string, data: FormData) => {
  const def = requireDefinition(slug);
  const reviewNotes = optText(2000).parse(fd.str(data, "reviewNotes"));
  await prisma.page.upsert({
    where: { slug },
    update: { reviewRequired: true, reviewNotes },
    create: { slug, title: def.title, reviewRequired: true, reviewNotes },
  });
  await logPage(def, admin, "flagged for review");
  revalidateSite();
});
