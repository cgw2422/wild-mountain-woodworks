"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/lib/admin/types";

export interface BarLink {
  label: string;
  href: string;
}

interface Context {
  edit: BarLink | null;
  secondary: BarLink | null;
  page: { slug: string; status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; canPublish: boolean } | null;
  previewing: boolean;
}

/**
 * Slim toolbar for signed-in staff on the public site. It is only ever
 * rendered after the server validated the session (SiteChrome), and every
 * link/action it offers is re-authorized by the admin itself. Visually
 * separate from the site's brand design on purpose.
 */
export function AdminBar({
  name,
  links,
  addNew,
  publish,
  logout,
}: {
  name: string;
  links: BarLink[];
  addNew: BarLink[];
  publish: ((slug: string, status: "PUBLISHED") => Promise<ActionResult>) | null;
  logout: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [ctx, setCtx] = useState<Context | null>(null);
  const [menu, setMenu] = useState<"add" | "mobile" | null>(null);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenu(null);
    setCtx(null);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/context?path=${encodeURIComponent(pathname)}`, { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<Context>) : null))
      .then((data) => {
        if (!cancelled) setCtx(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const draft = ctx?.page && ctx.page.status !== "PUBLISHED" ? ctx.page : null;
  const draftPreview = Boolean(draft && ctx?.previewing);
  const exitHref = `/api/admin/preview/exit?path=${encodeURIComponent(draft ? `/admin/pages/${draft.slug}` : "/admin")}`;

  return (
    <div
      role="region"
      aria-label="Admin toolbar"
      className="relative z-[60] bg-[#18191b] font-[system-ui,-apple-system,'Segoe_UI',sans-serif] text-[13px] leading-none text-neutral-200"
    >
      <div className="flex h-10 items-center gap-1 whitespace-nowrap px-2 sm:px-3">
        <Link href="/admin" className="mr-1 flex h-8 shrink-0 items-center rounded px-2 font-semibold text-white hover:bg-white/10">
          <span className="hidden sm:inline">Wild Mountain Admin</span>
          <span className="sm:hidden">WM Admin</span>
        </Link>

        {ctx?.edit ? (
          <Link href={ctx.edit.href} className="flex h-8 shrink-0 items-center gap-1.5 rounded px-2 font-medium text-white hover:bg-white/10">
            <PencilIcon />
            {ctx.edit.label}
          </Link>
        ) : null}
        {ctx?.secondary ? (
          <Link href={ctx.secondary.href} className="hidden h-8 shrink-0 items-center rounded px-2 hover:bg-white/10 md:flex">
            {ctx.secondary.label}
          </Link>
        ) : null}

        {addNew.length ? (
          <Dropdown label="+ Add New" open={menu === "add"} onToggle={(o) => setMenu(o ? "add" : null)} className="hidden md:block">
            {addNew.map((l) => (
              <DropdownLink key={l.href} link={l} />
            ))}
          </Dropdown>
        ) : null}

        <nav aria-label="Admin shortcuts" className={cn("hidden min-w-0 items-center gap-0.5 overflow-hidden", draftPreview ? "2xl:flex" : "xl:flex")}>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="flex h-8 shrink-0 items-center rounded px-2 text-neutral-300 hover:bg-white/10 hover:text-white">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {draftPreview && draft ? (
            <>
              <span className="rounded bg-amber-400 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-neutral-950">
                {draft.status === "ARCHIVED" ? "Archived preview" : "Draft preview"}
              </span>
              {draft.canPublish && publish ? <PublishButton slug={draft.slug} publish={publish} /> : null}
              <a href={exitHref} className="hidden h-8 items-center rounded px-2 hover:bg-white/10 sm:flex">
                Exit Preview
              </a>
            </>
          ) : draft && !ctx?.previewing ? (
            <a href={`/api/admin/preview?path=${encodeURIComponent(pathname)}`} className="flex h-8 items-center rounded bg-amber-400 px-2 font-semibold text-neutral-950">
              Preview draft
            </a>
          ) : null}
          <Link href="/admin" className="hidden h-8 items-center rounded px-2 hover:bg-white/10 md:flex">
            View Admin
          </Link>
          <span className="hidden max-w-40 truncate px-2 text-neutral-400 lg:inline" title={`Signed in as ${name}`}>
            {name}
          </span>
          <form action={logout} className="hidden md:block">
            <button type="submit" className="flex h-8 items-center rounded px-2 hover:bg-white/10">
              Log Out
            </button>
          </form>
          <Dropdown label="Menu" open={menu === "mobile"} onToggle={(o) => setMenu(o ? "mobile" : null)} className="md:hidden" align="right">
            {ctx?.secondary ? <DropdownLink link={ctx.secondary} /> : null}
            {draftPreview ? <DropdownLink link={{ label: "Exit Preview", href: exitHref }} plain /> : null}
            {addNew.length ? <p className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-wider text-neutral-500">Add New</p> : null}
            {addNew.map((l) => (
              <DropdownLink key={`n${l.href}`} link={l} />
            ))}
            <p className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-wider text-neutral-500">Go to</p>
            {links.map((l) => (
              <DropdownLink key={l.href} link={l} />
            ))}
            <div className="mt-1 border-t border-white/10 px-3 py-2 text-neutral-400">Signed in as {name}</div>
            <form action={logout}>
              <button type="submit" className="block w-full px-3 py-2.5 text-left hover:bg-white/10">
                Log Out
              </button>
            </form>
          </Dropdown>
        </div>
      </div>
    </div>
  );
}

function PublishButton({ slug, publish }: { slug: string; publish: (slug: string, status: "PUBLISHED") => Promise<ActionResult> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <button
      type="button"
      disabled={pending}
      title={error ?? undefined}
      onClick={() => {
        if (!window.confirm("Publish this page? It becomes visible to everyone, and appears in any menus that link to it.")) return;
        start(async () => {
          const res = await publish(slug, "PUBLISHED");
          // Full navigation through the route handler that clears the preview cookie.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          if (res.ok) window.location.assign(`/api/admin/preview/exit?path=${encodeURIComponent(window.location.pathname)}`);
          else setError(res.message ?? "Couldn't publish.");
        });
      }}
      className={cn("flex h-8 items-center rounded bg-emerald-500 px-2.5 font-semibold text-neutral-950 hover:bg-emerald-400", error && "bg-red-400")}
    >
      {pending ? "Publishing…" : error ? "Publish failed" : "Publish"}
    </button>
  );
}

function Dropdown({
  label,
  open,
  onToggle,
  children,
  className,
  align = "left",
}: {
  label: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children?: React.ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onToggle(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggle(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onToggle]);
  if (!children) return null;
  return (
    <div ref={ref} className={cn("relative shrink-0", className)}>
      <button type="button" aria-expanded={open} onClick={() => onToggle(!open)} className="flex h-8 items-center gap-1 whitespace-nowrap rounded px-2 hover:bg-white/10">
        {label}
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>
      {open ? (
        <div className={cn("absolute top-full mt-1 max-h-[75vh] w-60 overflow-y-auto rounded-md bg-[#232427] py-1 shadow-xl ring-1 ring-black/40", align === "right" ? "right-0" : "left-0")}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function DropdownLink({ link, plain }: { link: BarLink; plain?: boolean }) {
  const cls = "block px-3 py-2.5 hover:bg-white/10";
  return plain ? (
    <a href={link.href} className={cls}>
      {link.label}
    </a>
  ) : (
    <Link href={link.href} className={cls}>
      {link.label}
    </Link>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M11 2.5 13.5 5 6 12.5l-3 .5.5-3L11 2.5Z" />
    </svg>
  );
}
