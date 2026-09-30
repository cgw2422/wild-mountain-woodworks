"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { AdminError, fd, permittedAction } from "@/lib/admin/action";
import { revalidateSite } from "@/lib/revalidate";
import { isLinkablePage } from "@/lib/cms/pages";
import { MENU_LOCATIONS, isSafeInternalPath, safeExternalUrl, type MenuKey, type MenuItemTypeKey } from "@/lib/navigation/definitions";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Admin → Navigation. Every action requires the "navigation" permission
 * (owners, admins and editors) and validates every value server-side.
 */

function location(key: string) {
  const loc = MENU_LOCATIONS.find((l) => l.key === key);
  if (!loc) throw new AdminError("That menu doesn't exist.");
  return loc;
}

async function menuFor(key: string) {
  const loc = location(key);
  return prisma.menu.upsert({ where: { key: loc.key }, update: {}, create: { key: loc.key, name: loc.name } });
}

const TYPES = ["INTERNAL_PAGE", "CUSTOM_INTERNAL_LINK", "EXTERNAL_LINK", "PRODUCT_CATEGORY", "PRODUCT", "LABEL"] as const satisfies readonly MenuItemTypeKey[];

type ItemData = Pick<Prisma.MenuItemUncheckedCreateInput, "type" | "label" | "url" | "pageId" | "categoryId" | "productId" | "openInNewTab" | "enabled" | "parentId">;

/** Validate a menu item form against its menu. Throws AdminError with field errors. */
async function parseItem(data: FormData, menu: { id: string; key: string }, selfId?: string): Promise<ItemData> {
  const loc = location(menu.key);
  const type = z.enum(TYPES, { message: "Choose what this item links to." }).parse(fd.str(data, "type"));
  const label = z.string().trim().max(60, "Keep labels under 60 characters.").parse(fd.str(data, "label"));
  const errors: Record<string, string> = {};
  const item: ItemData = {
    type,
    label,
    url: null,
    pageId: null,
    categoryId: null,
    productId: null,
    openInNewTab: fd.bool(data, "openInNewTab"),
    enabled: fd.bool(data, "enabled"),
    parentId: null,
  };

  switch (type) {
    case "INTERNAL_PAGE": {
      const id = fd.str(data, "pageId");
      const page = id ? await prisma.page.findUnique({ where: { id }, select: { id: true, slug: true, isCustom: true } }) : null;
      if (!page || !isLinkablePage(page)) errors.pageId = "Choose a page.";
      else item.pageId = page.id;
      break;
    }
    case "PRODUCT_CATEGORY": {
      const id = fd.str(data, "categoryId");
      if (!id || !(await prisma.category.findUnique({ where: { id }, select: { id: true } }))) errors.categoryId = "Choose a category.";
      else item.categoryId = id;
      break;
    }
    case "PRODUCT": {
      const id = fd.str(data, "productId");
      if (!id || !(await prisma.product.findUnique({ where: { id }, select: { id: true } }))) errors.productId = "Choose a product.";
      else item.productId = id;
      break;
    }
    case "CUSTOM_INTERNAL_LINK": {
      const url = fd.str(data, "url");
      if (!isSafeInternalPath(url)) errors.url = "Use a path on this site that starts with /, e.g. /furniture/sale.";
      else item.url = url;
      if (!label) errors.label = "Enter a label.";
      break;
    }
    case "EXTERNAL_LINK": {
      const url = safeExternalUrl(fd.str(data, "url"));
      if (!url) errors.url = "Enter a full web address starting with https://.";
      else item.url = url;
      if (!label) errors.label = "Enter a label.";
      break;
    }
    case "LABEL":
      if (!label) errors.label = "Enter the heading text.";
      if (loc.maxDepth < 2) errors.type = "Headings are only used for dropdowns in the main navigation.";
      break;
  }

  const parentId = fd.str(data, "parentId");
  if (parentId) {
    if (loc.maxDepth < 2) errors.parentId = "This menu doesn't have sub-items.";
    const parent = await prisma.menuItem.findUnique({ where: { id: parentId }, select: { id: true, menuId: true, parentId: true } });
    if (!parent || parent.menuId !== menu.id) errors.parentId = "Choose a parent from this menu.";
    else if (parent.parentId) errors.parentId = "Sub-items can only go one level deep.";
    else if (parent.id === selfId) errors.parentId = "An item can't be its own parent.";
    else if (selfId && (await prisma.menuItem.count({ where: { parentId: selfId } })) > 0) errors.parentId = "This item has sub-items, so it must stay at the top level.";
    else item.parentId = parent.id;
  }

  if (Object.keys(errors).length) throw new AdminError("Please correct the highlighted fields.", errors);
  return item;
}

function describe(item: { type: string; label: string }) {
  return item.label || item.type.toLowerCase().replace(/_/g, " ");
}

export const saveMenuTitle = permittedAction("navigation", async (admin, key: MenuKey, data: FormData) => {
  const title = z.string().trim().max(60).parse(fd.str(data, "title")) || null;
  const menu = await menuFor(key);
  await prisma.menu.update({ where: { id: menu.id }, data: { title } });
  await logActivity("navigation.updated", `${admin.name} renamed the ${menu.name} heading to “${title ?? "(none)"}”`, { actorId: admin.id, entityType: "menu", entityId: menu.key });
  revalidateSite();
  return { ok: true, message: "Saved." };
});

export const createMenuItem = permittedAction("navigation", async (admin, key: MenuKey, data: FormData) => {
  const menu = await menuFor(key);
  const item = await parseItem(data, menu);
  const last = await prisma.menuItem.aggregate({ where: { menuId: menu.id, parentId: item.parentId ?? null }, _max: { displayOrder: true } });
  const created = await prisma.menuItem.create({ data: { ...item, menuId: menu.id, displayOrder: (last._max.displayOrder ?? -1) + 1 } });
  await logActivity("menu.item_created", `${admin.name} added “${describe(created)}” to the ${menu.name}`, { actorId: admin.id, entityType: "menu", entityId: menu.key });
  revalidateSite();
  return { ok: true, message: "Menu item added." };
});

export const updateMenuItem = permittedAction("navigation", async (admin, id: string, data: FormData) => {
  const existing = await prisma.menuItem.findUnique({ where: { id }, include: { menu: true } });
  if (!existing) throw new AdminError("That menu item no longer exists.");
  const item = await parseItem(data, existing.menu, id);
  const moving = (item.parentId ?? null) !== existing.parentId;
  let displayOrder = existing.displayOrder;
  if (moving) {
    const last = await prisma.menuItem.aggregate({ where: { menuId: existing.menuId, parentId: item.parentId ?? null }, _max: { displayOrder: true } });
    displayOrder = (last._max.displayOrder ?? -1) + 1;
  }
  await prisma.menuItem.update({ where: { id }, data: { ...item, displayOrder } });
  const changes = [
    existing.label !== item.label ? `label “${existing.label}” → “${item.label}”` : null,
    existing.enabled !== item.enabled ? (item.enabled ? "enabled" : "disabled") : null,
    existing.type !== item.type ? `type ${existing.type} → ${item.type}` : null,
    existing.url !== item.url ? `link ${existing.url ?? "—"} → ${item.url ?? "—"}` : null,
    moving ? "moved" : null,
  ].filter(Boolean);
  await logActivity("menu.item_updated", `${admin.name} updated “${describe(item as { type: string; label: string })}” in the ${existing.menu.name}${changes.length ? ` (${changes.join(", ")})` : ""}`, {
    actorId: admin.id,
    entityType: "menu",
    entityId: existing.menu.key,
  });
  revalidateSite();
  return { ok: true, message: "Menu item saved." };
});

export const setMenuItemEnabled = permittedAction("navigation", async (admin, id: string, enabled: boolean) => {
  const existing = await prisma.menuItem.findUnique({ where: { id }, include: { menu: true } });
  if (!existing) throw new AdminError("That menu item no longer exists.");
  await prisma.menuItem.update({ where: { id }, data: { enabled } });
  await logActivity("menu.item_updated", `${admin.name} ${enabled ? "enabled" : "disabled"} “${describe(existing)}” in the ${existing.menu.name}`, {
    actorId: admin.id,
    entityType: "menu",
    entityId: existing.menu.key,
  });
  revalidateSite();
  return { ok: true, message: enabled ? "Shown in the menu." : "Hidden from the menu." };
});

export const deleteMenuItem = permittedAction("navigation", async (admin, id: string) => {
  const existing = await prisma.menuItem.findUnique({ where: { id }, include: { menu: true, _count: { select: { children: true } } } });
  if (!existing) throw new AdminError("That menu item was already removed.");
  await prisma.menuItem.delete({ where: { id } }); // sub-items cascade
  await logActivity(
    "menu.item_deleted",
    `${admin.name} removed “${describe(existing)}”${existing._count.children ? ` and its ${existing._count.children} sub-item(s)` : ""} from the ${existing.menu.name}`,
    { actorId: admin.id, entityType: "menu", entityId: existing.menu.key },
  );
  revalidateSite();
  return { ok: true, message: "Removed from the menu." };
});

/** Save a new order for one level of one menu (top level, or the children of one item). */
export const reorderMenuItems = permittedAction("navigation", async (admin, key: MenuKey, parentId: string | null, ids: string[]) => {
  const menu = await menuFor(key);
  const list = z.array(z.string().min(1).max(40)).max(200).parse(ids);
  const siblings = await prisma.menuItem.findMany({ where: { menuId: menu.id, parentId: parentId ?? null }, select: { id: true } });
  const known = new Set(siblings.map((s) => s.id));
  if (list.length !== known.size || list.some((id) => !known.has(id))) throw new AdminError("The menu changed while you were editing. Please reload and try again.");
  await prisma.$transaction(list.map((id, i) => prisma.menuItem.update({ where: { id }, data: { displayOrder: i } })));
  await logActivity("menu.reordered", `${admin.name} reordered the ${menu.name}`, { actorId: admin.id, entityType: "menu", entityId: menu.key });
  revalidateSite();
  return { ok: true, message: "Order saved." };
});
