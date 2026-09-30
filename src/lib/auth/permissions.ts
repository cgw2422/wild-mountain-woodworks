/**
 * Role → permission matrix. Pure and client-safe, so the admin UI can hide
 * what a role can't use. UI hiding is never the control: every admin page
 * (requirePermission), server action (permittedAction / adminAction /
 * ownerAction) and admin API route (guardAdminApi) checks it on the server.
 *
 *   OWNER   everything
 *   ADMIN   ordinary site management — catalog, promotions, inbox, sales
 *           (quotes, customers, orders) and finance (invoices, payments),
 *           content, navigation, media, settings. Not admin users, roles or
 *           the owner audit log.
 *   EDITOR  editorial/CMS work — pages, homepage, portfolio, FAQs,
 *           navigation, media — plus their own password/two-factor. No
 *           access to quotes, customers, orders or any financial data.
 */
export type Role = "OWNER" | "ADMIN" | "EDITOR";

export const PERMISSIONS = [
  "dashboard", // admin dashboard (content shown is filtered per permission)
  "content", // pages, homepage, portfolio, FAQs
  "navigation", // menus
  "media", // media library and uploads
  "catalog", // products, categories, options, add-ons, pricing calculator
  "promotions", // announcement bar, sale collection
  "inbox", // custom requests and contact messages
  "sales", // quotes, customers, orders and production
  "finance", // quote pricing, invoices, payments, manual payments, refunds
  "settings", // site settings, feature flags, pricing defaults
  "own_account", // own password, two-factor, sessions
  "admin_users", // create/deactivate admins, roles, resets
  "audit", // owner audit log
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const EDITOR: readonly Permission[] = ["dashboard", "content", "navigation", "media", "own_account"];
const ADMIN: readonly Permission[] = PERMISSIONS.filter((p) => p !== "admin_users" && p !== "audit");

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(PERMISSIONS),
  ADMIN: new Set(ADMIN),
  EDITOR: new Set(EDITOR),
};

/** Default deny: unknown roles or permissions are never allowed. */
export function can(role: string | null | undefined, permission: Permission): boolean {
  return Boolean(role && (MATRIX as Record<string, ReadonlySet<Permission>>)[role]?.has(permission));
}

export const ROLE_LABELS: Record<Role, string> = { OWNER: "Owner", ADMIN: "Admin", EDITOR: "Editor" };

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: "Owner — everything, including admin users and security",
  ADMIN: "Admin — products, quotes, invoices, payments, orders, promotions, content and settings",
  EDITOR: "Editor — pages, homepage, portfolio, FAQs, navigation and media",
};
