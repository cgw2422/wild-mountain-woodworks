import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { AdminLinkButton, Badge, Card, EmptyState, PageHeader, formatDate } from "@/components/admin/ui";
import { ActionButton } from "@/components/admin/forms";
import { CatalogThumb } from "@/components/admin/catalog/CatalogThumb";
import { SortableRows } from "@/components/admin/catalog/SortableRows";
import { reorderAddOns, restoreAddOn } from "./actions";

export const metadata: Metadata = { title: "Add-ons" };
export const dynamic = "force-dynamic";

export default async function AddOnsPage() {
  const addOns = await prisma.addOn.findMany({
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: { image: { select: { url: true, alt: true, focalX: true, focalY: true } }, _count: { select: { products: true } } },
  });
  const current = addOns.filter((a) => !a.archivedAt);
  const archived = addOns.filter((a) => a.archivedAt);

  return (
    <>
      <PageHeader
        title="Add-ons"
        description="Extras customers can add to a piece — matching benches, drawers, delivery upgrades. Assign them to products and override prices per product."
        actions={<AdminLinkButton href="/admin/add-ons/new" variant="primary">New add-on</AdminLinkButton>}
      />
      {addOns.length === 0 ? (
        <EmptyState
          title="No add-ons yet"
          description="Create add-ons like “Matching Bench” or “Drawer” and assign them to products."
          action={<AdminLinkButton href="/admin/add-ons/new" variant="primary">Create an add-on</AdminLinkButton>}
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
          {current.length ? (
            <SortableRows
              onSave={reorderAddOns}
              hint="Default display order. Each product can reorder its own add-ons."
              rows={current.map((a) => ({
                id: a.id,
                label: a.name,
                content: (
                  <div className="flex flex-wrap items-center gap-3">
                    <CatalogThumb image={a.image} ratio={1} className="w-10" label="—" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/add-ons/${a.id}`} className="font-medium text-neutral-900 hover:underline">
                        {a.name}
                      </Link>
                      <p className="text-xs text-neutral-500">
                        {formatCents(a.priceCents)}
                        {a.maxQuantity > 1 ? ` each · up to ${a.maxQuantity}` : ""}
                        {a.required ? " · Required" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {a.scope === "PRODUCT_SPECIFIC" ? <Badge tone="violet">Product-specific</Badge> : null}
                      {!a.active ? <Badge tone="amber">Inactive</Badge> : null}
                      <span className="w-28 text-right text-sm tabular-nums text-neutral-600">
                        {a._count.products ? `${a._count.products} product${a._count.products === 1 ? "" : "s"}` : "Not assigned"}
                      </span>
                    </div>
                  </div>
                ),
              }))}
            />
          ) : (
            <EmptyState title="All add-ons are archived" description="Restore one below or create a new add-on." />
          )}
          {archived.length ? (
            <Card title="Archived" description="Archived add-ons are hidden from every product.">
              <ul className="divide-y divide-neutral-100">
                {archived.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/add-ons/${a.id}`} className="font-medium text-neutral-900 hover:underline">
                        {a.name}
                      </Link>
                      <p className="text-xs text-neutral-500">
                        Archived {formatDate(a.archivedAt)} · {formatCents(a.priceCents)}
                      </p>
                    </div>
                    <ActionButton action={restoreAddOn.bind(null, a.id)} variant="small" pendingLabel="Restoring…">
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
