import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PAGE_DEFINITIONS, customPageDefinition, type PageDefinition } from "@/lib/cms/definitions";
import { AdminLinkButton, Badge, PageHeader, StatusBadge, formatDate, table } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Pages" };
export const dynamic = "force-dynamic";

type Row = {
  def: PageDefinition;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  reviewRequired: boolean;
  updatedAt: Date | null;
  publishedAt: Date | null;
  updatedBy: string | null;
};

export default async function PagesIndex() {
  await requirePermission("content");
  const rows = await prisma.page.findMany({
    select: {
      slug: true,
      title: true,
      isCustom: true,
      status: true,
      reviewRequired: true,
      updatedAt: true,
      publishedAt: true,
      updatedBy: { select: { name: true } },
    },
    orderBy: { title: "asc" },
  });
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const toRow = (def: PageDefinition): Row => {
    const r = bySlug.get(def.slug);
    return {
      def,
      status: r?.status ?? "PUBLISHED",
      reviewRequired: r?.reviewRequired ?? false,
      updatedAt: r?.updatedAt ?? null,
      publishedAt: r?.publishedAt ?? null,
      updatedBy: r?.updatedBy?.name ?? null,
    };
  };
  const all: Row[] = [
    ...rows.filter((r) => r.isCustom).map((r) => toRow(customPageDefinition(r))),
    ...PAGE_DEFINITIONS.map(toRow),
  ];
  const live = all.filter((r) => r.status !== "ARCHIVED");
  const needsReview = rows.filter((r) => r.reviewRequired).length;

  const groups: Array<{ title: string; description: string; rows: Row[]; empty?: string }> = [
    {
      title: "Your pages",
      description: "Pages created here. New pages start as drafts; publish when ready, then add them to a menu in Navigation.",
      rows: live.filter((r) => r.def.kind === "custom"),
      empty: "No pages yet. Use “Create page” to add one — for example Financing, Trade Program or Our Story.",
    },
    { title: "Site pages", description: "Structured pages built from sections. Edit copy, images, buttons and visibility.", rows: live.filter((r) => r.def.kind === "system") },
    {
      title: "Customer care & policy pages",
      description: "Long-form pages written in Markdown. Draft policy language is flagged for owner/legal review.",
      rows: live.filter((r) => r.def.kind === "policy"),
    },
    { title: "Archived", description: "Not on the public site. Open a page to restore it.", rows: all.filter((r) => r.status === "ARCHIVED") },
  ];

  return (
    <>
      <PageHeader
        title="Pages"
        description="Create pages, edit copy and images, and publish, draft or archive them. Draft and archived pages are hidden from visitors, menus and the sitemap."
        actions={
          <>
            {needsReview ? <Badge tone="amber">{needsReview} page{needsReview === 1 ? "" : "s"} need review</Badge> : null}
            <AdminLinkButton href="/admin/pages/new" variant="primary">
              Create page
            </AdminLinkButton>
          </>
        }
      />
      <div className="space-y-8">
        {groups
          .filter((g) => g.rows.length || g.empty)
          .map((g) => (
            <section key={g.title} aria-labelledby={`grp-${g.title}`}>
              <h2 id={`grp-${g.title}`} className="text-base font-semibold text-neutral-900">
                {g.title}
              </h2>
              <p className="mb-3 text-sm text-neutral-500">{g.description}</p>
              {g.rows.length ? <PagesTable rows={g.rows} /> : <p className="rounded-md border border-dashed border-neutral-300 p-4 text-sm text-neutral-600">{g.empty}</p>}
            </section>
          ))}
      </div>
    </>
  );
}

function PagesTable({ rows }: { rows: Row[] }) {
  return (
    <div className={`${table.wrap} relative`}>
      <table className={table.table}>
        <thead className={table.thead}>
          <tr>
            <th scope="col" className={table.th}>Page</th>
            <th scope="col" className={table.th}>Public URL</th>
            <th scope="col" className={table.th}>Status</th>
            <th scope="col" className={table.th}>Last edited</th>
            <th scope="col" className={table.th}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className={table.tbody}>
          {rows.map(({ def, status, reviewRequired, updatedAt, publishedAt, updatedBy }) => {
            const editHref = def.slug === "home" ? "/admin/homepage" : `/admin/pages/${def.slug}`;
            const sharedTemplate = def.slug === "product" || def.slug === "portfolio-project";
            const path = def.kind === "custom" ? `/${def.slug}` : def.path;
            const title = def.title;
            return (
              <tr key={def.slug} className={table.tr}>
                <td className={table.td}>
                  <Link href={editHref} className="font-medium text-neutral-900 hover:underline">
                    {title}
                  </Link>
                  {def.kind !== "custom" ? <p className="text-xs text-neutral-500">{def.description}</p> : null}
                  {reviewRequired ? (
                    <Badge tone="amber" className="mt-1">
                      Needs owner/legal review
                    </Badge>
                  ) : null}
                </td>
                <td className={table.td}>
                  {sharedTemplate ? (
                    <span className="text-xs text-neutral-500">Shared on every {def.slug === "product" ? "product" : "project"} page</span>
                  ) : (
                    <span className="whitespace-nowrap font-mono text-xs text-neutral-700">{path}</span>
                  )}
                </td>
                <td className={table.td}>
                  <StatusBadge status={status} />
                  {status === "PUBLISHED" && publishedAt ? <p className="mt-1 whitespace-nowrap text-xs text-neutral-500">since {formatDate(publishedAt)}</p> : null}
                </td>
                <td className={`${table.td} whitespace-nowrap text-neutral-600`}>
                  {updatedAt ? formatDate(updatedAt, true) : "Never edited"}
                  {updatedBy ? <p className="text-xs text-neutral-500">by {updatedBy}</p> : null}
                </td>
                <td className={`${table.td} whitespace-nowrap text-right`}>
                  <span className="inline-flex gap-3">
                    {!sharedTemplate ? (
                      <a
                        href={status === "PUBLISHED" ? path : `/api/admin/preview?path=${encodeURIComponent(path)}`}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex min-h-11 min-w-11 items-center justify-center text-sm text-neutral-600 underline hover:text-neutral-900"
                      >
                        {status === "PUBLISHED" ? "View" : "Preview"}
                        <span className="sr-only"> {title} (opens in a new tab)</span>
                      </a>
                    ) : null}
                    <Link href={editHref} className="inline-flex min-h-11 min-w-11 items-center justify-center text-sm font-medium text-neutral-900 underline">
                      Edit<span className="sr-only"> {title}</span>
                    </Link>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
