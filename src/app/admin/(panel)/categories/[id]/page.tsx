import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AdminLinkButton, Badge, Card, PageHeader, StatusBadge, formatDate } from "@/components/admin/ui";
import { ActionButton, ConfirmAction } from "@/components/admin/forms";
import { archiveCategory, deleteCategory, restoreCategory, updateCategory } from "../actions";
import { CategoryForm } from "../CategoryForm";
import { toImageValue } from "../../products/_lib/media";

export const metadata: Metadata = { title: "Edit category" };
export const dynamic = "force-dynamic";

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const category = await prisma.category.findUnique({
    where: { id },
    include: {
      image: true,
      products: { orderBy: { name: "asc" }, select: { id: true, name: true, status: true }, take: 50 },
      _count: { select: { products: true } },
    },
  });
  if (!category) notFound();
  const archived = Boolean(category.archivedAt);
  const count = category._count.products;

  return (
    <>
      <PageHeader
        title={category.name}
        breadcrumbs={[{ label: "Categories", href: "/admin/categories" }, { label: category.name }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {archived ? <Badge tone="amber">Archived</Badge> : category.visible ? <Badge tone="green">Visible</Badge> : <Badge>Hidden</Badge>}
            {category.showOnHomepage && !archived ? <Badge tone="blue">On homepage</Badge> : null}
            <span>Updated {formatDate(category.updatedAt, true)}</span>
          </span>
        }
        actions={
          !archived && category.visible ? (
            <AdminLinkButton href={category.linkUrl ?? `/furniture/${category.slug}`} target="_blank">
              View live ↗
            </AdminLinkButton>
          ) : null
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <CategoryForm
          mode="edit"
          action={updateCategory.bind(null, category.id)}
          values={{
            name: category.name,
            slug: category.slug,
            description: category.description ?? "",
            linkUrl: category.linkUrl ?? "",
            seoTitle: category.seoTitle ?? "",
            seoDescription: category.seoDescription ?? "",
            visible: category.visible,
            showOnHomepage: category.showOnHomepage,
            image: toImageValue(category.image),
            archived,
          }}
        />
        <aside className="grid content-start gap-6">
          <Card title={`Products (${count})`}>
            {count === 0 ? (
              <p className="text-sm text-neutral-500">No products use this category.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {category.products.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <Link href={`/admin/products/${p.id}`} className="truncate text-neutral-800 hover:underline">
                      {p.name}
                    </Link>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
                {count > category.products.length ? (
                  <li>
                    <Link href={`/admin/products?category=${category.id}`} className="text-neutral-600 underline">
                      View all {count}
                    </Link>
                  </li>
                ) : null}
              </ul>
            )}
          </Card>
          <Card title="Manage">
            <div className="grid gap-3">
              {archived ? (
                <ActionButton action={restoreCategory.bind(null, category.id)} pendingLabel="Restoring…">
                  Restore category
                </ActionButton>
              ) : (
                <ConfirmAction
                  action={archiveCategory.bind(null, category.id)}
                  label="Archive category"
                  title={`Archive “${category.name}”?`}
                  body="The category will be hidden from the public site and the homepage. Its products keep their category. You can restore it any time."
                  confirmLabel="Archive"
                  successMessage="Category archived."
                />
              )}
              {count === 0 ? (
                <ConfirmAction
                  action={deleteCategory.bind(null, category.id)}
                  label="Delete permanently"
                  variant="danger"
                  title={`Delete “${category.name}”?`}
                  body="This permanently removes the category. This can't be undone."
                  confirmLabel="Delete"
                  redirectTo="/admin/categories"
                />
              ) : (
                <p className="text-xs text-neutral-500">
                  This category can&apos;t be deleted while {count} product{count === 1 ? " uses" : "s use"} it. Move those products to another category, or archive this category instead.
                </p>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
