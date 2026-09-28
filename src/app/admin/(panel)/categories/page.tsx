import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { AdminLinkButton, Badge, Card, EmptyState, PageHeader, formatDate } from "@/components/admin/ui";
import { ActionButton } from "@/components/admin/forms";
import { CatalogThumb } from "@/components/admin/catalog/CatalogThumb";
import { SortableRows } from "@/components/admin/catalog/SortableRows";
import { reorderCategories, restoreCategory } from "./actions";

export const metadata: Metadata = { title: "Categories" };
export const dynamic = "force-dynamic";

const imageSelect = { select: { url: true, alt: true, focalX: true, focalY: true } } as const;

export default async function CategoriesPage() {
  const categories = await prisma.category.findMany({
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: { image: imageSelect, _count: { select: { products: true } } },
  });
  const active = categories.filter((c) => !c.archivedAt);
  const archived = categories.filter((c) => c.archivedAt);

  return (
    <>
      <PageHeader
        title="Categories"
        description="Categories group products under /furniture. The order below is used on the homepage tiles and furniture navigation."
        actions={<AdminLinkButton href="/admin/categories/new" variant="primary">New category</AdminLinkButton>}
      />

      {categories.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Create categories like “Dining Tables” or “Benches” to organize your furniture."
          action={<AdminLinkButton href="/admin/categories/new" variant="primary">Create a category</AdminLinkButton>}
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
          {active.length ? (
            <SortableRows
              onSave={reorderCategories}
              rows={active.map((c) => ({
                id: c.id,
                label: c.name,
                content: (
                  <div className="flex items-center gap-3">
                    <CatalogThumb image={c.image} className="w-10" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/categories/${c.id}`} className="font-medium text-neutral-900 hover:underline">
                        {c.name}
                      </Link>
                      <p className="truncate font-mono text-xs text-neutral-500">{c.linkUrl ? `→ ${c.linkUrl}` : `/furniture/${c.slug}`}</p>
                    </div>
                    <div className="hidden flex-wrap items-center justify-end gap-1.5 sm:flex">
                      {!c.visible ? <Badge>Hidden</Badge> : null}
                      {c.showOnHomepage ? <Badge tone="blue">Homepage</Badge> : null}
                      {c.linkUrl ? <Badge tone="violet">Link override</Badge> : null}
                    </div>
                    <span className="w-24 shrink-0 text-right text-sm tabular-nums text-neutral-600">
                      {c._count.products} product{c._count.products === 1 ? "" : "s"}
                    </span>
                  </div>
                ),
              }))}
            />
          ) : (
            <EmptyState title="All categories are archived" description="Restore one below or create a new category." />
          )}

          {archived.length ? (
            <Card title="Archived" description="Archived categories are hidden from the public site.">
              <ul className="divide-y divide-neutral-100">
                {archived.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <CatalogThumb image={c.image} className="w-10" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/categories/${c.id}`} className="font-medium text-neutral-900 hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-neutral-500">
                        Archived {formatDate(c.archivedAt)} · {c._count.products} product{c._count.products === 1 ? "" : "s"}
                      </p>
                    </div>
                    <ActionButton action={restoreCategory.bind(null, c.id)} variant="small" pendingLabel="Restoring…">
                      Restore
                    </ActionButton>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
