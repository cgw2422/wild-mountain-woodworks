import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { isLinkablePage, pagePath } from "@/lib/cms/pages";
import { isSafeInternalPath, safeExternalUrl, type MenuKey } from "./definitions";

export interface NavLink {
  id: string;
  label: string;
  /** null for a non-clickable heading (dropdown parent). */
  href: string | null;
  newTab: boolean;
  external: boolean;
  children: NavLink[];
}

export interface ResolvedMenu {
  key: MenuKey;
  title: string | null;
  items: NavLink[];
}

const itemInclude = {
  page: { select: { slug: true, title: true, navLabel: true, status: true, isCustom: true } },
  category: { select: { name: true, slug: true, linkUrl: true, visible: true, archivedAt: true } },
  product: { select: { name: true, slug: true, status: true, category: { select: { visible: true, archivedAt: true } } } },
} as const;

type Row = Awaited<ReturnType<typeof loadRows>>[number];

function loadRows(menuId: string) {
  return prisma.menuItem.findMany({ where: { menuId }, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }], include: itemInclude });
}

/**
 * Resolve one stored item to a public link, or null when it must not render.
 * This is the safety net for menus: a page that is Draft/Archived, a hidden
 * category, a product that isn't live, an unsafe URL or a disabled item
 * simply never renders — the stored
 * item stays, so it returns automatically when its target is live again.
 */
export function resolveItem(row: Row): Omit<NavLink, "children"> | null {
  if (!row.enabled) return null;
  const label = row.label.trim();
  const link = (fallback: string, href: string | null, external = false) => ({
    id: row.id,
    label: label || fallback,
    href,
    newTab: row.openInNewTab,
    external,
  });
  switch (row.type) {
    case "INTERNAL_PAGE": {
      const p = row.page;
      if (!p || p.status !== "PUBLISHED" || !isLinkablePage(p)) return null;
      return link(p.navLabel?.trim() || p.title, pagePath(p));
    }
    case "PRODUCT_CATEGORY": {
      const c = row.category;
      if (!c || !c.visible || c.archivedAt) return null;
      return link(c.name, c.linkUrl?.trim() || `/furniture/${c.slug}`);
    }
    case "PRODUCT": {
      const p = row.product;
      if (!p || p.status !== "ACTIVE" || (p.category && (!p.category.visible || p.category.archivedAt))) return null;
      return link(p.name, `/furniture/${p.slug}`);
    }
    case "CUSTOM_INTERNAL_LINK":
      return row.url && isSafeInternalPath(row.url) && label ? link(label, row.url) : null;
    case "EXTERNAL_LINK": {
      const url = row.url ? safeExternalUrl(row.url) : null;
      return url && label ? link(label, url, true) : null;
    }
    case "LABEL":
      return label ? link(label, null) : null;
  }
}

/** Build the visible tree (two levels). Headings without visible children are dropped. */
export function buildTree(rows: Row[]): NavLink[] {
  const resolved = new Map<string, Omit<NavLink, "children">>();
  for (const r of rows) {
    const link = resolveItem(r);
    if (link) resolved.set(r.id, link);
  }
  const top = rows.filter((r) => !r.parentId && resolved.has(r.id));
  return top
    .map((r) => ({
      ...resolved.get(r.id)!,
      children: rows.filter((c) => c.parentId === r.id && resolved.has(c.id)).map((c) => ({ ...resolved.get(c.id)!, children: [] })),
    }))
    .filter((l) => l.href || l.children.length);
}

/** A public menu, resolved for this request. Unknown/missing menus are empty. */
export const getMenu = cache(async (key: MenuKey): Promise<ResolvedMenu> => {
  const menu = await prisma.menu.findUnique({ where: { key } });
  if (!menu) return { key, title: null, items: [] };
  return { key, title: menu.title, items: buildTree(await loadRows(menu.id)) };
});
