import Link from "next/link";
import { cn } from "@/lib/cn";
import { adminButton } from "@/components/admin/ui";

export const PAGE_SIZE = 25;

type SearchParams = Record<string, string | string[] | undefined>;

export function param(sp: SearchParams, key: string): string {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export function pageParam(sp: SearchParams): number {
  const n = Number.parseInt(param(sp, "page"), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 1;
}

/** Build a list URL keeping only non-empty params. */
export function listHref(base: string, params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" || (k === "page" && Number(v) <= 1)) continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

export function FilterTabs({
  tabs,
  active,
  label = "Filter by status",
}: {
  tabs: Array<{ key: string; label: string; href: string; count?: number }>;
  active: string;
  label?: string;
}) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto pb-1">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900",
                  isActive ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-200/70",
                )}
              >
                {t.label}
                {t.count !== undefined ? (
                  <span className={cn("rounded px-1.5 text-xs tabular-nums", isActive ? "bg-white/20" : "bg-neutral-200 text-neutral-700")}>{t.count}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Plain GET search form (works without JavaScript). Keeps the active filter. */
export function SearchBox({
  action,
  q,
  placeholder,
  hidden = {},
}: {
  action: string;
  q: string;
  placeholder: string;
  hidden?: Record<string, string>;
}) {
  return (
    <form action={action} method="get" role="search" className="flex w-full gap-2 sm:w-auto">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="sr-only" htmlFor="inbox-search">
        Search
      </label>
      <input
        id="inbox-search"
        type="search"
        name="q"
        defaultValue={q}
        placeholder={placeholder}
        maxLength={100}
        className="block h-9 w-full min-w-0 rounded border border-neutral-300 bg-white px-3 text-sm placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 sm:w-72"
      />
      <button type="submit" className={adminButton.secondary}>
        Search
      </button>
      {q ? (
        <Link href={listHref(action, hidden)} className={adminButton.ghost}>
          Clear
        </Link>
      ) : null}
    </form>
  );
}

export function Pagination({
  page,
  total,
  pageSize = PAGE_SIZE,
  href,
}: {
  page: number;
  total: number;
  pageSize?: number;
  href: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-600">
      <p>
        Showing <span className="tabular-nums">{from > total ? 0 : from}</span>–<span className="tabular-nums">{to}</span> of{" "}
        <span className="tabular-nums">{total}</span>
      </p>
      {pages > 1 ? (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link href={href(page - 1)} className={adminButton.small} rel="prev">
              ← Previous
            </Link>
          ) : (
            <span className={cn(adminButton.small, "pointer-events-none opacity-40")} aria-hidden="true">
              ← Previous
            </span>
          )}
          <span className="tabular-nums">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={href(page + 1)} className={adminButton.small} rel="next">
              Next →
            </Link>
          ) : (
            <span className={cn(adminButton.small, "pointer-events-none opacity-40")} aria-hidden="true">
              Next →
            </span>
          )}
        </div>
      ) : null}
    </nav>
  );
}
