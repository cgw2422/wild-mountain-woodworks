"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/brand/Logo";

export type NavCounts = { quotes: number; customRequests: number; messages: number };

const GROUPS: Array<{ label: string; items: Array<{ href: string; label: string; count?: keyof NavCounts }> }> = [
  { label: "Overview", items: [{ href: "/admin", label: "Dashboard" }] },
  {
    label: "Inbox",
    items: [
      { href: "/admin/quotes", label: "Quotes", count: "quotes" },
      { href: "/admin/custom-requests", label: "Custom Requests", count: "customRequests" },
      { href: "/admin/messages", label: "Messages", count: "messages" },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/admin/products", label: "Products" },
      { href: "/admin/categories", label: "Categories" },
      { href: "/admin/options", label: "Options" },
      { href: "/admin/add-ons", label: "Add-ons" },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/admin/homepage", label: "Homepage" },
      { href: "/admin/pages", label: "Pages" },
      { href: "/admin/portfolio", label: "Portfolio / Our Work" },
      { href: "/admin/faqs", label: "FAQs" },
      { href: "/admin/media", label: "Media" },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/admin/settings", label: "Settings" },
      { href: "/admin/orders", label: "Future Orders" },
    ],
  },
];

export function AdminNav({ counts, userName, logout }: { counts: NavCounts; userName: string; logout: () => Promise<void> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Close the mobile menu on navigation (state reset during render).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/"));

  const nav = (
    <nav aria-label="Admin" className="flex-1 overflow-y-auto px-3 py-4">
      {GROUPS.map((g) => (
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
                      <span className="ml-2 rounded-full bg-bronze-light px-1.5 text-[0.7rem] font-semibold leading-5 text-charcoal" aria-label={`${count} new`}>
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
        <Link href="/admin" className="py-3 text-ivory" aria-label="Admin dashboard">
          <Logo variant="horizontal" className="h-4 w-auto" title="" />
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
        <Link href="/admin" className="block px-6 pb-3 pt-6 text-ivory" aria-label="Admin dashboard">
          <Logo variant="compact" className="w-40" title="" />
          <span className="mt-2 block text-[0.68rem] uppercase tracking-[0.2em] text-white/40">Admin</span>
        </Link>
        {nav}
        {footer}
      </aside>
    </>
  );
}
