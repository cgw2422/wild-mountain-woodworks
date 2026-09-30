import { cookies } from "next/headers";
import { getCurrentAdmin } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { logoutAction } from "@/app/admin/login/actions";
import { setPageStatus } from "@/app/admin/(panel)/pages/actions";
import { AdminBar, type BarLink } from "./AdminBar";

/**
 * Renders the admin bar only for a validated staff session (signed in,
 * two-factor enrolled, active — re-read from the database every request).
 * For anyone else this returns nothing, so no admin links, names or
 * actions ever reach an anonymous visitor's HTML.
 */
export async function SiteAdminBar() {
  // Fast path for visitors: no admin session cookie → no lookup at all.
  // (The cookie is only a hint; getCurrentAdmin validates it server-side.)
  const jar = await cookies();
  if (!jar.has("wm_admin.session_token") && !jar.has("__Secure-wm_admin.session_token")) return null;
  const admin = await getCurrentAdmin().catch(() => null);
  if (!admin) return null;
  const r = admin.role;
  const links: BarLink[] = [
    { label: "Dashboard", href: "/admin" },
    ...(can(r, "catalog") ? [{ label: "Products", href: "/admin/products" }] : []),
    ...(can(r, "content") ? [{ label: "Pages", href: "/admin/pages" }] : []),
    ...(can(r, "media") ? [{ label: "Media", href: "/admin/media" }] : []),
    ...(can(r, "navigation") ? [{ label: "Navigation", href: "/admin/navigation" }] : []),
    ...(can(r, "promotions") ? [{ label: "Promotions", href: "/admin/promotions" }] : []),
    ...(can(r, "sales") ? [{ label: "Quotes", href: "/admin/quotes" }, { label: "Orders", href: "/admin/orders" }] : []),
  ];
  const addNew: BarLink[] = [
    ...(can(r, "catalog") ? [{ label: "Product", href: "/admin/products/new" }] : []),
    ...(can(r, "content")
      ? [
          { label: "Page", href: "/admin/pages/new" },
          { label: "Portfolio Project", href: "/admin/portfolio/new" },
          { label: "FAQ", href: "/admin/faqs" },
        ]
      : []),
    ...(can(r, "promotions") ? [{ label: "Promotion", href: "/admin/promotions" }] : []),
    ...(can(r, "sales") && can(r, "finance") ? [{ label: "Quote", href: "/admin/quotes/new" }] : []),
  ];
  return (
    <AdminBar
      name={admin.name}
      links={links}
      addNew={addNew}
      publish={can(r, "content") ? setPageStatus : null}
      logout={logoutAction}
    />
  );
}
