import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { AdminLinkButton, Badge, EmptyState, PageHeader } from "@/components/admin/ui";
import { SortableRows } from "@/components/admin/catalog/SortableRows";
import { RunActionButton } from "@/components/admin/catalog/RunActionButton";
import { duplicateOptionGroup, reorderOptionGroups } from "./actions";
import { inputTypeLabel } from "./input-types";

export const metadata: Metadata = { title: "Options" };
export const dynamic = "force-dynamic";

export default async function OptionsPage() {
  const groups = await prisma.optionGroup.findMany({
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { values: true, products: true } } },
  });

  return (
    <>
      <PageHeader
        title="Options"
        description="The global option library — sizes, wood species, finishes and more. Attach groups to products and fine-tune them per product."
        actions={<AdminLinkButton href="/admin/options/new" variant="primary">New option group</AdminLinkButton>}
      />
      {groups.length === 0 ? (
        <EmptyState
          title="No option groups yet"
          description="Create reusable option groups like “Wood Species” or “Finish”, then attach them to products."
          action={<AdminLinkButton href="/admin/options/new" variant="primary">Create an option group</AdminLinkButton>}
        />
      ) : (
        <SortableRows
          onSave={reorderOptionGroups}
          hint="This order is the default order of groups when attaching them to new products."
          rows={groups.map((g) => ({
            id: g.id,
            label: g.name,
            content: (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/options/${g.id}`} className="font-medium text-neutral-900 hover:underline">
                    {g.name}
                  </Link>
                  <p className="text-xs text-neutral-500">
                    Customers see “{g.displayName}” · {inputTypeLabel(g.inputType)} · {g.required ? "Required" : "Optional"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!g.active ? <Badge tone="amber">Inactive</Badge> : null}
                  <span className="w-20 text-right text-sm tabular-nums text-neutral-600">
                    {g._count.values} value{g._count.values === 1 ? "" : "s"}
                  </span>
                  <span className="w-28 text-right text-sm tabular-nums text-neutral-600">
                    {g._count.products ? `Used by ${g._count.products}` : "Not used"}
                  </span>
                  <RunActionButton
                    action={duplicateOptionGroup.bind(null, g.id)}
                    navigatePrefix="/admin/options/"
                    variant="small"
                    confirm={{
                      title: `Duplicate “${g.name}”?`,
                      body: `Creates “Copy of ${g.name}” with all ${g._count.values} value${g._count.values === 1 ? "" : "s"}. It isn't attached to any product until you attach it.`,
                      confirmLabel: "Duplicate",
                    }}
                    pendingLabel="Duplicating…"
                  >
                    Duplicate
                  </RunActionButton>
                </div>
              </div>
            ),
          }))}
        />
      )}
    </>
  );
}
