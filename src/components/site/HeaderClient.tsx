"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
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

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="link-underline text-[0.8rem] font-medium tracking-[0.04em] text-charcoal"
    >
      {children}
    </Link>
  );
}

/** Full-screen mobile navigation dialog with focus management. */
export function MobileMenu({
  items,
  cta,
  contact,
}: {
  items: Array<{ href: string; label: string }>;
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
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={pathname === item.href || pathname.startsWith(item.href + "/") ? "page" : undefined}
                    className="block py-2.5 font-display text-[2.1rem] leading-tight text-ivory aria-[current=page]:text-bronze-light"
                  >
                    {item.label}
                  </Link>
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
