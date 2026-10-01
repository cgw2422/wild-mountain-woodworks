import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { canChangeStatus, customPageDefinition, getPageDefinition } from "./definitions";

/** "/About/?x#y" → "/about": the form paths are compared in. */
export function normalizePath(path: string): string {
  const clean = path.split("#")[0]!.split("?")[0]!.replace(/\/+$/, "").toLowerCase();
  return clean || "/";
}

/**
 * Public paths of every page that is currently Draft or Archived. Menus,
 * breadcrumbs, section buttons, built-in links, the header button and the
 * sitemap use this to suppress links to pages visitors can't open.
 * Memoized per request.
 */
export const unpublishedPagePaths = cache(async (): Promise<Set<string>> => {
  const rows = await prisma.page.findMany({ where: { status: { not: "PUBLISHED" } }, select: { slug: true, title: true, isCustom: true } });
  const paths = new Set<string>();
  for (const row of rows) {
    const def = row.isCustom ? customPageDefinition(row) : getPageDefinition(row.slug);
    if (def && canChangeStatus(def)) paths.add(normalizePath(def.path));
  }
  return paths;
});

/** Whether a link points at a page visitors can currently open (external links always can). */
export async function isPathPublic(path: string): Promise<boolean> {
  if (!path.startsWith("/") || path.startsWith("//")) return true;
  return !(await unpublishedPagePaths()).has(normalizePath(path));
}
