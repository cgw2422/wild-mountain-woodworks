import "server-only";
import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { canChangeStatus, customPageDefinition, getPageDefinition, type PageDefinition } from "./definitions";
import { getPageContent, type PageContent } from "./queries";
import { getPreviewer } from "@/lib/preview";

/**
 * Any editable page: a code-defined page (definitions.ts) or a page created
 * in Admin → Pages (Page.isCustom). Null when neither exists.
 */
export const resolvePageDefinition = cache(async (slug: string): Promise<PageDefinition | null> => {
  const def = getPageDefinition(slug);
  if (def) return def;
  const page = await prisma.page.findFirst({ where: { slug, isCustom: true }, select: { slug: true, title: true } });
  return page ? customPageDefinition(page) : null;
});

export type VisiblePage = { def: PageDefinition; page: PageContent; preview: boolean };

/**
 * A page as a visitor may see it right now. Published pages (and the
 * homepage, which is always published) are visible to everyone. Draft and
 * archived pages are visible only to signed-in staff with the "content"
 * permission who switched on preview (Draft Mode) — everyone else gets
 * null → 404.
 */
export async function getVisiblePage(slug: string): Promise<VisiblePage | null> {
  const def = await resolvePageDefinition(slug);
  if (!def) return null;
  const page = await getPageContent(slug);
  if (page.status === "PUBLISHED" || !canChangeStatus(def)) return { def, page, preview: false };
  return (await getPreviewer("content")) ? { def, page, preview: true } : null;
}

/** Public URL of a page row (code-defined path, or /{slug} for created pages). */
export function pagePath(page: { slug: string; isCustom: boolean }): string {
  return page.isCustom ? `/${page.slug}` : (getPageDefinition(page.slug)?.path ?? `/${page.slug}`);
}

/**
 * Where a page is reachable as a standalone public URL (menus can link it).
 * Shared templates (product, project content blocks) don't qualify.
 */
export function isLinkablePage(page: { slug: string; isCustom: boolean }): boolean {
  if (page.isCustom) return true;
  const def = getPageDefinition(page.slug);
  return Boolean(def && !def.template);
}

export { isPathPublic, normalizePath, unpublishedPagePaths } from "./visibility";

/** For page components: the visible page, or the site's 404. */
export async function requireVisiblePage(slug: string): Promise<VisiblePage> {
  const visible = await getVisiblePage(slug);
  if (!visible) notFound();
  return visible;
}

export const NOT_FOUND_METADATA: Metadata = { title: "Not found", robots: { index: false, follow: false } };

/** Draft previews are never indexed. */
export async function withPreviewRobots(visible: VisiblePage, pending: Metadata | Promise<Metadata>): Promise<Metadata> {
  const metadata = await pending;
  return visible.preview ? { ...metadata, title: `Draft preview · ${String(metadata.title ?? visible.page.title)}`, robots: { index: false, follow: false } } : metadata;
}
