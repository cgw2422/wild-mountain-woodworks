"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { NavLink as NavLinkData } from "@/lib/navigation/menus";
import { Logo } from "@/components/brand/Logo";

/** Sticky header that gains a hairline border once the page scrolls. */
export function HeaderShell({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header
      className={cn(
        "sticky top-0 z-40 h-[4.5rem] bg-ivory/95 backdrop-blur-sm transition-[box-shadow,border-color] duration-300 lg:h-20",
        "border-b",
        scrolled ? "border-stone" : "border-transparent",
      )}
    >
      {children}
    </header>
  );
}

const isActive = (pathname: string, href: string | null) => Boolean(href && !/^https?:/.test(href) && (pathname === href || (href !== "/" && pathname.startsWith(href + "/"))));

/** A menu link: internal via next/link, external as a plain anchor (new tab when set). */
export function MenuAnchor({ item, className, onClick, children }: { item: NavLinkData; className?: string; onClick?: () => void; children?: React.ReactNode }) {
  const pathname = usePathname();
  const newTab = item.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {};
  if (item.external) {
    return (
      <a href={item.href!} className={className} onClick={onClick} {...newTab}>
        {children ?? item.label}
        {item.newTab ? <span className="sr-only"> (opens in a new tab)</span> : null}
      </a>
    );
  }
  return (
    <Link href={item.href!} className={className} onClick={onClick} aria-current={isActive(pathname, item.href) ? "page" : undefined} {...newTab}>
      {children ?? item.label}
    </Link>
  );
}

const topLinkCls = "link-underline text-[0.8rem] font-medium tracking-[0.04em] text-charcoal";

/** Desktop main navigation: plain links, and dropdowns for items with sub-items. */
export function MainNav({ items }: { items: NavLinkData[] }) {
  return (
    <ul className="flex items-center gap-7 xl:gap-9">
      {items.map((item) => (
        <li key={item.id} className="relative">
          {item.children.length ? <NavDropdown item={item} /> : <MenuAnchor item={item} className={topLinkCls} />}
        </li>
      ))}
    </ul>
  );
}

function NavDropdown({ item }: { item: NavLinkData }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const menuId = `nav-${item.id}`;
  return (
    <div ref={ref} className="flex items-center gap-1" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {item.href ? <MenuAnchor item={item} className={topLinkCls} /> : <span className="text-[0.8rem] font-medium tracking-[0.04em] text-charcoal">{item.label}</span>}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="-mr-2 flex h-8 w-6 items-center justify-center text-charcoal"
      >
        <span className="sr-only">{item.label} menu</span>
        <svg viewBox="0 0 12 12" className={cn("h-2.5 w-2.5 transition-transform", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>
      <div id={menuId} hidden={!open} className="absolute left-1/2 top-full z-50 -translate-x-1/2 pt-3">
        <ul className="min-w-56 border border-stone bg-paper py-3 shadow-[0_10px_30px_rgba(31,30,28,0.08)]">
          {item.children.map((c) => (
            <li key={c.id}>
              <MenuAnchor item={c} className="block px-5 py-2 text-[0.88rem] text-charcoal hover:bg-ivory-deep aria-[current=page]:text-bronze-text" onClick={() => setOpen(false)} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Full-screen mobile navigation dialog with focus management. */
export function MobileMenu({
  items,
  cta,
  contact,
}: {
  items: NavLinkData[];
  cta: { label: string; href: string };
  contact: { email: string | null; phone: string | null };
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close the menu on navigation (state reset during render, not in an effect).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      document.documentElement.style.overflow = "hidden";
    } else if (!open && d.open) {
      d.close();
    }
    if (!open) document.documentElement.style.overflow = "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="-mr-2 flex h-11 w-11 items-center justify-center text-charcoal lg:hidden"
      >
        <span className="sr-only">Open menu</span>
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
          <path d="M3 7h18M3 12h18M9 17h12" />
        </svg>
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Menu"
        onClose={() => {
          setOpen(false);
          buttonRef.current?.focus();
        }}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        className="on-dark m-0 h-dvh max-h-none w-full max-w-none bg-charcoal p-0 text-ivory backdrop:bg-transparent"
      >
        <div className="flex h-full flex-col px-6 pb-8">
          <div className="flex h-[4.5rem] items-center justify-between">
            <Link href="/" className="text-ivory [--logo-accent:var(--color-bronze-light)]" aria-label="Wild Mountain Woodworks — home" onClick={() => setOpen(false)}>
              <Logo variant="compact" className="h-[2.35rem] w-auto" title="" />
            </Link>
            <button type="button" onClick={() => setOpen(false)} className="-mr-2 flex h-11 w-11 items-center justify-center" aria-label="Close menu">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                <path d="M5 5l14 14M19 5L5 19" />
              </svg>
            </button>
          </div>
          <nav aria-label="Mobile" className="mt-8 flex-1 overflow-y-auto">
            <ul className="space-y-1">
              {items.map((item) => (
                <li key={item.id}>
                  {item.href ? (
                    <MenuAnchor
                      item={item}
                      onClick={() => setOpen(false)}
                      className="block py-2.5 font-display text-[2.1rem] leading-tight text-ivory aria-[current=page]:text-bronze-light"
                    />
                  ) : (
                    <p className="pb-1 pt-4 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ivory/60">{item.label}</p>
                  )}
                  {item.children.length ? (
                    <ul className="mb-2 ml-1 space-y-0.5 border-l border-white/15 pl-4">
                      {item.children.map((c) => (
                        <li key={c.id}>
                          <MenuAnchor
                            item={c}
                            onClick={() => setOpen(false)}
                            className="block py-1.5 text-[1.05rem] text-ivory/85 aria-[current=page]:text-bronze-light"
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </nav>
          <div className="space-y-5 border-t border-white/15 pt-6">
            <Link
              href={cta.href}
              onClick={() => setOpen(false)}
              className="flex min-h-12 w-full items-center justify-center bg-ivory px-6 text-[0.74rem] font-semibold uppercase tracking-[0.16em] text-charcoal"
            >
              {cta.label}
            </Link>
            {contact.email || contact.phone ? (
              <div className="flex flex-col gap-1 text-sm text-ivory/70">
                {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}
                {contact.phone ? <a href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`}>{contact.phone}</a> : null}
              </div>
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}
