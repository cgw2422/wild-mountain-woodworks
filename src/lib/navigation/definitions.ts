/**
 * Where menus render on the public site. The locations are part of the
 * design; everything inside them (items, order, nesting, labels, links) is
 * edited in Admin → Navigation. Client-safe.
 */
export const MENU_LOCATIONS = [
  { key: "MAIN", name: "Main navigation", description: "The header menu. Items with sub-items become dropdowns.", maxDepth: 2 },
  { key: "FOOTER", name: "Footer navigation", description: "The first footer column (shop links).", maxDepth: 1 },
  { key: "COMPANY", name: "Company menu", description: "The footer's company column.", maxDepth: 1 },
  { key: "CUSTOMER_CARE", name: "Customer Care menu", description: "The footer's customer care column and the sidebar on customer care pages.", maxDepth: 1 },
  { key: "LEGAL", name: "Legal links", description: "The small links at the very bottom of the footer.", maxDepth: 1 },
] as const;

export type MenuKey = (typeof MENU_LOCATIONS)[number]["key"];

export const MENU_ITEM_TYPES = [
  { type: "INTERNAL_PAGE", label: "Page", help: "A page from Admin → Pages. Hidden automatically while the page is a draft or archived." },
  { type: "PRODUCT_CATEGORY", label: "Product category", help: "Hidden while the category is hidden or archived." },
  { type: "PRODUCT", label: "Product", help: "Hidden while the product isn't live." },
  { type: "CUSTOM_INTERNAL_LINK", label: "Link on this site", help: "Any path on this site, e.g. /furniture/sale." },
  { type: "EXTERNAL_LINK", label: "External link", help: "A full https:// address, e.g. Instagram." },
  { type: "LABEL", label: "Heading (no link)", help: "A non-clickable parent for a dropdown. Hidden when it has no visible sub-items." },
] as const;

export type MenuItemTypeKey = (typeof MENU_ITEM_TYPES)[number]["type"];

/** Site paths only: "/x", never "//host" or backslashes. */
export function isSafeInternalPath(v: string): boolean {
  return v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") && !/\s/.test(v) && v.length <= 500;
}

/** Only http(s) URLs (never javascript:, data:, etc.). Returns the normalized URL or null. */
export function safeExternalUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}
