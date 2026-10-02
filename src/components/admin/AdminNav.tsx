"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/brand/Logo";
import { can, type Permission, type Role } from "@/lib/auth/permissions";

export type NavCounts = { quotes: number; customRequests: number; messages: number; invoices: number };

type NavItem = { href: string; label: string; count?: keyof NavCounts; permission: Permission | "admin" };

/** Each item names the permission that unlocks it; the pages enforce the same rule server-side. */
const GROUPS: Array<{ label: string; items: NavItem[] }> = [
  { label: "Overview", items: [{ href: "/admin", label: "Dashboard", permission: "dashboard" }] },
  {
    label: "Sales",
    items: [
      { href: "/admin/quotes", label: "Quotes", count: "quotes", permission: "sales" },
      { href: "/admin/orders", label: "Orders", permission: "sales" },
      { href: "/admin/invoices", label: "Invoices", count: "invoices", permission: "finance" },
      { href: "/admin/payments", label: "Payments", permission: "finance" },
      { href: "/admin/customers", label: "Customers", permission: "sales" },
    ],
  },
  {
    label: "Inbox",
    items: [
      { href: "/admin/custom-requests", label: "Custom Requests", count: "customRequests", permission: "inbox" },
      { href: "/admin/messages", label: "Messages", count: "messages", permission: "inbox" },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/admin/products", label: "Products", permission: "catalog" },
      { href: "/admin/categories", label: "Categories", permission: "catalog" },
      { href: "/admin/options", label: "Options", permission: "catalog" },
      { href: "/admin/add-ons", label: "Add-ons", permission: "catalog" },
      { href: "/admin/promotions", label: "Promotions", permission: "promotions" },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/admin/homepage", label: "Homepage", permission: "content" },
      { href: "/admin/pages", label: "Pages", permission: "content" },
      { href: "/admin/navigation", label: "Navigation", permission: "navigation" },
      { href: "/admin/portfolio", label: "Portfolio / Our Work", permission: "content" },
      { href: "/admin/faqs", label: "FAQs", permission: "content" },
      { href: "/admin/media", label: "Media", permission: "media" },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/admin/pricing-cheat-sheet", label: "Pricing Cheat Sheet", permission: "catalog" },
      { href: "/admin/pricing-calculator", label: "Pricing Calculator", permission: "catalog" },
      { href: "/admin/settings", label: "Settings", permission: "settings" },
      { href: "/admin/settings/emails", label: "Emails", permission: "settings" },
      { href: "/admin/security", label: "Security", permission: "own_account" },
    ],
  },
];

export function AdminNav({ counts, userName, role, logout }: { counts: NavCounts; userName: string; role: Role; logout: () => Promise<void> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Close the mobile menu on navigation (state reset during render).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  const matches = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/"));
  // The most specific match wins (e.g. Emails over Settings on /admin/settings/emails).
  const allHrefs = GROUPS.flatMap((g) => g.items.map((i) => i.href));
  const isActive = (href: string) => matches(href) && !allHrefs.some((h) => h.length > href.length && h.startsWith(href) && matches(h));

  const nav = (
    <nav aria-label="Admin" className="flex-1 overflow-y-auto px-3 py-4">
      {GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.permission === "admin" || can(role, i.permission)) }))
        .filter((g) => g.items.length)
        .map((g) => (
        <div key={g.label} className="mb-5">
          <p className="px-3 pb-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-white/40">{g.label}</p>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const active = isActive(item.href);
              const count = item.count ? counts[item.count] : 0;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center justify-between rounded px-3 py-2 text-sm transition",
                      active ? "bg-white/12 font-medium text-white" : "text-white/70 hover:bg-white/6 hover:text-white",
                    )}
                  >
                    <span>{item.label}</span>
                    {count > 0 ? (
                      <span className="ml-2 rounded-full bg-bronze-light px-1.5 text-[0.7rem] font-semibold leading-5 text-charcoal" aria-label={item.count === "invoices" ? `${count} past due` : `${count} new`}>
                        {count}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-white/10 p-4 text-sm">
      <p className="truncate text-white/80">{userName}</p>
      <div className="mt-2 flex items-center gap-4">
        <Link href="/" target="_blank" className="text-white/60 hover:text-white">
          View site ↗
        </Link>
        <form action={logout}>
          <button type="submit" className="text-white/60 hover:text-white">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between bg-charcoal px-4 lg:hidden">
        <Link href="/admin" className="py-3 text-ivory [--logo-accent:var(--color-bronze-light)]" aria-label="Admin dashboard">
          <Logo variant="horizontal" className="h-5 w-auto" title="" />
        </Link>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="admin-mobile-nav"
          className="rounded px-3 py-2 text-sm font-medium text-ivory hover:bg-white/10"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open ? (
        <div id="admin-mobile-nav" className="fixed inset-x-0 bottom-0 top-14 z-30 flex flex-col bg-charcoal lg:hidden">
          {nav}
          {footer}
        </div>
      ) : null}

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-charcoal lg:flex">
        <Link href="/admin" className="block px-6 pb-3 pt-6 text-ivory [--logo-accent:var(--color-bronze-light)]" aria-label="Admin dashboard">
          <Logo variant="compact" className="w-40" title="" />
          <span className="mt-2 block text-[0.68rem] uppercase tracking-[0.2em] text-white/40">Admin</span>
        </Link>
        {nav}
        {footer}
      </aside>
    </>
  );
}
