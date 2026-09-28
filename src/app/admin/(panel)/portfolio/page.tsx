import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { AdminLinkButton, EmptyState, PageHeader, formatDate, table } from "@/components/admin/ui";
import { reorderProjects } from "./actions";
import { PortfolioList, type ProjectRow } from "./PortfolioList";

export const metadata: Metadata = { title: "Portfolio" };

export default async function PortfolioIndex() {
  await requireAdmin();
  const projects = await prisma.portfolioProject.findMany({
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    include: {
      _count: { select: { images: true } },
      images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 1, include: { media: { select: { url: true, focalX: true, focalY: true } } } },
    },
  });
  const rows: ProjectRow[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    featured: p.featured,
    isSample: p.isSample,
    imageCount: p._count.images,
    updatedAt: p.updatedAt.toISOString(),
    image: p.images[0]?.media ?? null,
  }));
  const active = rows.filter((r) => r.status !== "ARCHIVED");
  const archived = rows.filter((r) => r.status === "ARCHIVED");

  return (
    <>
      <PageHeader
        title="Portfolio / Our Work"
        description="Completed pieces shown on the Our Work page. Separate from products — these showcase past builds. Drag to set the order they appear."
        actions={
          <>
            <AdminLinkButton href="/our-work" target="_blank">
              View Our Work ↗
            </AdminLinkButton>
            <AdminLinkButton href="/admin/portfolio/new" variant="primary">
              New project
            </AdminLinkButton>
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No portfolio projects yet"
          description="Show off finished pieces with photos, the wood and finish used, and the story behind the build."
          action={
            <AdminLinkButton href="/admin/portfolio/new" variant="primary">
              Create your first project
            </AdminLinkButton>
          }
        />
      ) : (
        <div className="space-y-8">
          {active.length ? (
            <PortfolioList projects={active} onReorder={reorderProjects} />
          ) : (
            <p className="rounded border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">
              All projects are archived. <Link href="/admin/portfolio/new" className="underline">Create a new project</Link> or restore one below.
            </p>
          )}
          {archived.length ? (
            <section aria-labelledby="archived-h">
              <h2 id="archived-h" className="mb-2 text-sm font-semibold text-neutral-700">
                Archived ({archived.length})
              </h2>
              <div className={`${table.wrap} relative`}>
                <table className={table.table}>
                  <thead className={table.thead}>
                    <tr>
                      <th scope="col" className={table.th}>
                        Project
                      </th>
                      <th scope="col" className={table.th}>
                        Photos
                      </th>
                      <th scope="col" className={table.th}>
                        Updated
                      </th>
                    </tr>
                  </thead>
                  <tbody className={table.tbody}>
                    {archived.map((p) => (
                      <tr key={p.id} className={table.tr}>
                        <td className={table.td}>
                          <Link href={`/admin/portfolio/${p.id}`} className="font-medium text-neutral-900 hover:underline">
                            {p.name}
                          </Link>
                        </td>
                        <td className={table.td}>{p.imageCount}</td>
                        <td className={`${table.td} whitespace-nowrap`}>{formatDate(p.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}
