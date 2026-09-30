import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { MENU_LOCATIONS } from "@/lib/navigation/definitions";
import { resolveItem } from "@/lib/navigation/menus";
import { isLinkablePage, pagePath } from "@/lib/cms/pages";
import { getPageDefinition } from "@/lib/cms/definitions";
import { PageHeader } from "@/components/admin/ui";
import { MenuEditor, type EditorItem, type EditorOptions } from "@/components/admin/navigation/MenuEditor";
import { createMenuItem, deleteMenuItem, reorderMenuItems, saveMenuTitle, setMenuItemEnabled, updateMenuItem } from "./actions";

export const metadata: Metadata = { title: "Navigation" };
export const dynamic = "force-dynamic";

export default async function NavigationPage() {
  await requirePermission("navigation");
  const [menus, pages, categories, products] = await Promise.all([
    prisma.menu.findMany({
      include: {
        items: {
          orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
          include: {
            page: { select: { slug: true, title: true, navLabel: true, status: true, isCustom: true } },
            category: { select: { name: true, slug: true, linkUrl: true, visible: true, archivedAt: true } },
            product: { select: { name: true, slug: true, status: true, category: { select: { visible: true, archivedAt: true } } } },
          },
        },
      },
    }),
    prisma.page.findMany({ select: { id: true, slug: true, title: true, status: true, isCustom: true }, orderBy: { title: "asc" } }),
    prisma.category.findMany({ where: { archivedAt: null }, select: { id: true, name: true, visible: true }, orderBy: { displayOrder: "asc" } }),
    prisma.product.findMany({ where: { status: { not: "ARCHIVED" } }, select: { id: true, name: true, status: true }, orderBy: { name: "asc" } }),
  ]);

  const options: EditorOptions = {
    pages: pages
      .filter((p) => isLinkablePage(p) && p.slug !== "home")
      .map((p) => ({ id: p.id, label: p.isCustom ? p.title : (getPageDefinition(p.slug)?.title ?? p.title), path: pagePath(p), status: p.status })),
    categories: categories.map((c) => ({ id: c.id, label: c.name, hidden: !c.visible })),
    products: products.map((p) => ({ id: p.id, label: p.name, live: p.status === "ACTIVE" })),
  };

  return (
    <>
      <PageHeader
        title="Navigation"
        description="Menus shown in the site header and footer. Links to pages, categories and products that aren't live are hidden from visitors automatically, and come back when they're published."
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        {MENU_LOCATIONS.map((loc) => {
          const menu = menus.find((m) => m.key === loc.key);
          const rows = menu?.items ?? [];
          const items: EditorItem[] = rows.map((r) => {
            const live = resolveItem(r);
            const childrenLive = rows.some((c) => c.parentId === r.id && resolveItem(c));
            let hidden: string | null = null;
            if (!r.enabled) hidden = "Disabled";
            else if (!live) {
              if (r.type === "INTERNAL_PAGE") hidden = r.page ? `Hidden — the page is ${r.page.status.toLowerCase()}` : "Hidden — the page no longer exists";
              else if (r.type === "PRODUCT_CATEGORY") hidden = r.category ? "Hidden — the category is hidden or archived" : "Hidden — the category no longer exists";
              else if (r.type === "PRODUCT") hidden = r.product ? "Hidden — the product isn't live" : "Hidden — the product no longer exists";
              else hidden = "Hidden — check the label and link";
            } else if (r.type === "LABEL" && !childrenLive) hidden = "Hidden until it has a visible sub-item";
            return {
              id: r.id,
              parentId: r.parentId,
              type: r.type,
              label: r.label,
              displayLabel: live?.label || r.label || r.page?.title || r.category?.name || r.product?.name || "(untitled)",
              destination: live?.href ?? r.url ?? (r.page ? pagePath(r.page) : null),
              url: r.url,
              pageId: r.pageId,
              categoryId: r.categoryId,
              productId: r.productId,
              enabled: r.enabled,
              openInNewTab: r.openInNewTab,
              hidden,
            };
          });
          return (
            <MenuEditor
              key={loc.key}
              menuKey={loc.key}
              name={loc.name}
              description={loc.description}
              maxDepth={loc.maxDepth}
              title={menu?.title ?? null}
              items={items}
              options={options}
              actions={{
                saveTitle: saveMenuTitle.bind(null, loc.key),
                create: createMenuItem.bind(null, loc.key),
                update: updateMenuItem,
                remove: deleteMenuItem,
                setEnabled: setMenuItemEnabled,
                reorder: reorderMenuItems.bind(null, loc.key),
              }}
            />
          );
        })}
      </div>
    </>
  );
}
