import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { getMediaUsageCounts } from "@/lib/media/service";
import { cn } from "@/lib/cn";
import type { Prisma } from "@/generated/prisma/client";
import { Badge, EmptyState, PageHeader, adminButton, formatBytes, formatDate } from "@/components/admin/ui";
import { MediaUploader } from "./MediaUploader";

export const metadata: Metadata = { title: "Media" };

const PAGE_SIZE = 48;

const IN_USE: Prisma.MediaWhereInput = {
  OR: [
    { productImages: { some: {} } },
    { portfolioImages: { some: {} } },
    { categories: { some: {} } },
    { optionValues: { some: {} } },
    { addOns: { some: {} } },
    { pageSections: { some: {} } },
    { pageSectionItems: { some: {} } },
    { pagesOg: { some: {} } },
    { settingsOg: { some: {} } },
  ],
};
const UNUSED: Prisma.MediaWhereInput = {
  AND: [
    { productImages: { none: {} } },
    { portfolioImages: { none: {} } },
    { categories: { none: {} } },
    { optionValues: { none: {} } },
    { addOns: { none: {} } },
    { pageSections: { none: {} } },
    { pageSectionItems: { none: {} } },
    { pagesOg: { none: {} } },
    { settingsOg: { none: {} } },
  ],
};

const FILTERS = {
  all: { label: "All", where: {} as Prisma.MediaWhereInput },
  used: { label: "In use", where: IN_USE },
  unused: { label: "Unused", where: UNUSED },
  noalt: { label: "Missing alt text", where: { alt: "" } as Prisma.MediaWhereInput },
  sample: { label: "Sample content", where: { isSample: true } as Prisma.MediaWhereInput },
} as const;
type FilterKey = keyof typeof FILTERS;

type Props = { searchParams: Promise<{ q?: string; filter?: string; page?: string }> };

export default async function MediaLibrary({ searchParams }: Props) {
  await requireAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const filter: FilterKey = sp.filter && sp.filter in FILTERS ? (sp.filter as FilterKey) : "all";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const search: Prisma.MediaWhereInput = q
    ? {
        OR: [
          { originalName: { contains: q, mode: "insensitive" } },
          { filename: { contains: q, mode: "insensitive" } },
          { alt: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};
  const where: Prisma.MediaWhereInput = { AND: [search, FILTERS[filter].where] };

  const [items, total, ...filterCounts] = await Promise.all([
    prisma.media.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.media.count({ where }),
    ...(Object.keys(FILTERS) as FilterKey[]).map((k) => prisma.media.count({ where: { AND: [search, FILTERS[k].where] } })),
  ]);
  const usage = await getMediaUsageCounts(items.map((i) => i.id));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const libraryEmpty = filter === "all" && !q && total === 0;

  const href = (next: { filter?: FilterKey; page?: number; q?: string }) => {
    const params = new URLSearchParams();
    const nq = next.q ?? q;
    const nf = next.filter ?? filter;
    if (nq) params.set("q", nq);
    if (nf !== "all") params.set("filter", nf);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const s = params.toString();
    return `/admin/media${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Media library"
        description="Every photograph on the website lives here. Replace an image once and it updates everywhere it's used. Originals are never altered — each location crops around the focal point you set."
      />

      <div className="mb-6">
        <MediaUploader />
      </div>

      {libraryEmpty ? (
        <EmptyState title="Your media library is empty" description="Upload photographs of your furniture, workshop and projects above. You can then use them anywhere on the site." />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <nav aria-label="Filter media" className="-mx-1 flex flex-wrap gap-1">
              {(Object.keys(FILTERS) as FilterKey[]).map((k, i) => (
                <Link
                  key={k}
                  href={href({ filter: k, page: 1 })}
                  aria-current={filter === k ? "page" : undefined}
                  className={cn(
                    "rounded px-3 py-1.5 text-sm font-medium",
                    filter === k ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-200/70",
                  )}
                >
                  {FILTERS[k].label} <span className={cn("tabular-nums", filter === k ? "text-neutral-300" : "text-neutral-500")}>{filterCounts[i]}</span>
                </Link>
              ))}
            </nav>
            <form role="search" action="/admin/media" className="flex gap-2">
              {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
              <label htmlFor="media-q" className="sr-only">
                Search by filename or alt text
              </label>
              <input
                id="media-q"
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search filename or alt text…"
                className="h-9 w-full min-w-0 rounded border border-neutral-300 bg-white px-3 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 lg:w-72"
              />
              <button type="submit" className={adminButton.secondary}>
                Search
              </button>
              {q ? (
                <Link href={href({ q: "", page: 1 })} className={adminButton.ghost}>
                  Clear
                </Link>
              ) : null}
            </form>
          </div>

          {items.length === 0 ? (
            <EmptyState
              title="No images match"
              description={q ? `Nothing matches “${q}” in ${FILTERS[filter].label.toLowerCase()}.` : `There are no images in “${FILTERS[filter].label}”.`}
              action={
                <Link href="/admin/media" className={adminButton.secondary}>
                  Show all images
                </Link>
              }
            />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6" aria-label="Images">
              {items.map((m) => {
                const n = usage[m.id] ?? 0;
                return (
                  <li key={m.id}>
                    <Link
                      href={`/admin/media/${m.id}`}
                      className="group block overflow-hidden rounded-md border border-neutral-200 bg-white hover:border-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                    >
                      <span className="relative block aspect-square bg-neutral-100">
                        <Image
                          src={m.url}
                          alt={m.alt || ""}
                          fill
                          sizes="(min-width: 1280px) 200px, (min-width: 768px) 25vw, 50vw"
                          className="object-cover"
                          style={{ objectPosition: `${m.focalX}% ${m.focalY}%` }}
                          placeholder={m.blurDataUrl ? "blur" : "empty"}
                          blurDataURL={m.blurDataUrl ?? undefined}
                        />
                        <span className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
                          {!m.alt ? <Badge tone="amber">No alt</Badge> : null}
                          {m.isSample ? <Badge tone="violet">Sample</Badge> : null}
                        </span>
                      </span>
                      <span className="block space-y-0.5 px-2.5 py-2">
                        <span className="block truncate text-xs font-medium text-neutral-900" title={m.originalName}>
                          {m.originalName}
                        </span>
                        <span className="block text-[0.7rem] text-neutral-500">
                          {m.width}×{m.height} · {formatBytes(m.size)}
                        </span>
                        <span className="block text-[0.7rem] text-neutral-500">{formatDate(m.createdAt)}</span>
                        <span className={cn("block text-[0.7rem] font-medium", n ? "text-emerald-700" : "text-neutral-500")}>
                          {n ? `Used in ${n} place${n === 1 ? "" : "s"}` : "Unused"}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {pages > 1 ? (
            <nav aria-label="Pagination" className="mt-6 flex items-center justify-between gap-3 text-sm">
              <span className="text-neutral-600">
                Page {page} of {pages} · {total} images
              </span>
              <span className="flex gap-2">
                {page > 1 ? (
                  <Link href={href({ page: page - 1 })} className={adminButton.secondary} rel="prev">
                    ← Previous
                  </Link>
                ) : null}
                {page < pages ? (
                  <Link href={href({ page: page + 1 })} className={adminButton.secondary} rel="next">
                    Next →
                  </Link>
                ) : null}
              </span>
            </nav>
          ) : (
            <p className="mt-6 text-sm text-neutral-500">
              {total} image{total === 1 ? "" : "s"}
            </p>
          )}
        </>
      )}
    </>
  );
}
