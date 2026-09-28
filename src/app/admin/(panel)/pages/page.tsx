import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { PAGE_DEFINITIONS, type PageDefinition } from "@/lib/cms/definitions";
import { Badge, PageHeader, StatusBadge, formatDate, table } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Pages" };

export default async function PagesIndex() {
  await requireAdmin();
  const rows = await prisma.page.findMany({ select: { slug: true, status: true, reviewRequired: true, updatedAt: true } });
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const needsReview = rows.filter((r) => r.reviewRequired).length;

  const groups: Array<{ title: string; description: string; pages: PageDefinition[] }> = [
    {
      title: "Site pages",
      description: "Structured pages built from sections. Edit copy, images, buttons and visibility.",
      pages: PAGE_DEFINITIONS.filter((p) => p.kind === "system"),
    },
    {
      title: "Customer care & policy pages",
      description: "Long-form pages written in Markdown. Draft policy language is flagged for owner/legal review.",
      pages: PAGE_DEFINITIONS.filter((p) => p.kind === "policy"),
    },
  ];

  return (
    <>
      <PageHeader
        title="Pages"
        description="Every page's copy, images, SEO and social sharing image. Changes go live as soon as you save."
        actions={needsReview ? <Badge tone="amber">{needsReview} page{needsReview === 1 ? "" : "s"} need review</Badge> : null}
      />
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.title} aria-labelledby={`grp-${g.title}`}>
            <h2 id={`grp-${g.title}`} className="text-base font-semibold text-neutral-900">
              {g.title}
            </h2>
            <p className="mb-3 text-sm text-neutral-500">{g.description}</p>
            <div className={`${table.wrap} relative`}>
              <table className={table.table}>
                <thead className={table.thead}>
                  <tr>
                    <th scope="col" className={table.th}>
                      Page
                    </th>
                    <th scope="col" className={table.th}>
                      Public URL
                    </th>
                    <th scope="col" className={table.th}>
                      Status
                    </th>
                    <th scope="col" className={table.th}>
                      Last updated
                    </th>
                    <th scope="col" className={table.th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className={table.tbody}>
                  {g.pages.map((def) => {
                    const row = bySlug.get(def.slug);
                    const editHref = def.slug === "home" ? "/admin/homepage" : `/admin/pages/${def.slug}`;
                    const sharedTemplate = def.slug === "product" || def.slug === "portfolio-project";
                    return (
                      <tr key={def.slug} className={table.tr}>
                        <td className={table.td}>
                          <Link href={editHref} className="font-medium text-neutral-900 hover:underline">
                            {def.title}
                          </Link>
                          <p className="text-xs text-neutral-500">{def.description}</p>
                          {row?.reviewRequired ? (
                            <Badge tone="amber" className="mt-1">
                              Needs owner/legal review
                            </Badge>
                          ) : null}
                        </td>
                        <td className={table.td}>
                          {sharedTemplate ? (
                            <span className="text-xs text-neutral-500">Shared on every {def.slug === "product" ? "product" : "project"} page</span>
                          ) : (
                            <a href={def.path} target="_blank" rel="noopener" className="whitespace-nowrap text-neutral-700 underline hover:text-neutral-900">
                              {def.path}
                              <span className="sr-only"> (opens in a new tab)</span>
                            </a>
                          )}
                        </td>
                        <td className={table.td}>
                          <StatusBadge status={row?.status ?? "PUBLISHED"} />
                        </td>
                        <td className={`${table.td} whitespace-nowrap text-neutral-600`}>{row ? formatDate(row.updatedAt, true) : "Never edited"}</td>
                        <td className={`${table.td} text-right`}>
                          <Link href={editHref} className="text-sm font-medium text-neutral-900 underline">
                            Edit<span className="sr-only"> {def.title}</span>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
