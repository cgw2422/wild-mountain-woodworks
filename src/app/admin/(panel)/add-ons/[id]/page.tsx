import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { centsToDollarInput } from "@/lib/money";
import { Badge, Card, PageHeader, formatDate } from "@/components/admin/ui";
import { ActionButton, ConfirmAction } from "@/components/admin/forms";
import { toImageValue } from "../../products/_lib/media";
import {
  archiveAddOn,
  assignAddOnToProduct,
  attachAddOnOptionGroup,
  deleteAddOn,
  detachAddOnOptionGroup,
  removeAddOnFromProduct,
  reorderAddOnOptionGroups,
  restoreAddOn,
  updateAddOn,
  updateAddOnAssignment,
  updateAddOnOptionGroup,
} from "../actions";
import { AddOnOptionGroups } from "./AddOnOptionGroups";
import { AddOnForm } from "../AddOnForm";
import { AssignedProducts } from "./AssignedProducts";

export const metadata: Metadata = { title: "Edit add-on" };
export const dynamic = "force-dynamic";

export default async function AddOnPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const addOn = await prisma.addOn.findUnique({
    where: { id },
    include: {
      image: true,
      products: { include: { product: { select: { id: true, name: true, status: true } } }, orderBy: { product: { name: "asc" } } },
      optionGroups: { orderBy: { displayOrder: "asc" }, include: { optionGroup: { include: { _count: { select: { values: true } } } } } },
    },
  });
  if (!addOn) notFound();
  const assignedIds = new Set(addOn.products.map((p) => p.productId));
  const allProducts = await prisma.product.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, status: true } });
  const archived = Boolean(addOn.archivedAt);
  const attachedGroupIds = new Set(addOn.optionGroups.map((g) => g.optionGroupId));
  const libraryGroups = await prisma.optionGroup.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, displayName: true, active: true } });
  const count = addOn.products.length;

  return (
    <>
      <PageHeader
        title={addOn.name}
        breadcrumbs={[{ label: "Add-ons", href: "/admin/add-ons" }, { label: addOn.name }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {archived ? <Badge tone="amber">Archived</Badge> : addOn.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
            {addOn.scope === "PRODUCT_SPECIFIC" ? <Badge tone="violet">Product-specific</Badge> : <Badge>Reusable</Badge>}
            <span>Updated {formatDate(addOn.updatedAt)}</span>
          </span>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid min-w-0 content-start gap-6">
          {archived ? (
            <p className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">This add-on is archived and hidden from every product. Restore it to offer it again.</p>
          ) : null}
          <AddOnForm
            mode="edit"
            action={updateAddOn.bind(null, addOn.id)}
            values={{
              name: addOn.name,
              displayName: addOn.displayName ?? "",
              description: addOn.description ?? "",
              price: centsToDollarInput(addOn.priceCents),
              image: toImageValue(addOn.image),
              scope: addOn.scope,
              required: addOn.required,
              minQuantity: String(addOn.minQuantity),
              maxQuantity: String(addOn.maxQuantity),
              quantityEnabled: addOn.quantityEnabled,
              quantityStep: String(addOn.quantityStep),
              defaultQuantity: addOn.defaultQuantity != null ? String(addOn.defaultQuantity) : "",
              active: addOn.active,
            }}
          />
          <Card
            id="option-groups"
            title={`Configuration (${addOn.optionGroups.length} option group${addOn.optionGroups.length === 1 ? "" : "s"})`}
            description="Make this a configurable add-on (e.g. Dining Chairs: Chair Style, Wood Species, Chair Finish, Seat Finish). Groups come from the option library (Options), where you manage each value's name, price adjustment, image or swatch, order and active state. They belong to this add-on only — not to the main product."
          >
            <AddOnOptionGroups
              groups={addOn.optionGroups.map((g) => ({
                optionGroupId: g.optionGroupId,
                name: g.optionGroup.name,
                displayName: g.optionGroup.displayName,
                inputType: g.optionGroup.inputType,
                active: g.optionGroup.active,
                required: g.optionGroup.required,
                valueCount: g.optionGroup._count.values,
                displayNameOverride: g.displayNameOverride ?? "",
                requiredOverride: g.requiredOverride == null ? "inherit" : g.requiredOverride ? "required" : "optional",
              }))}
              available={libraryGroups.filter((g) => !attachedGroupIds.has(g.id))}
              attach={attachAddOnOptionGroup.bind(null, addOn.id)}
              update={updateAddOnOptionGroup.bind(null, addOn.id)}
              detach={detachAddOnOptionGroup.bind(null, addOn.id)}
              reorder={reorderAddOnOptionGroups.bind(null, addOn.id)}
            />
          </Card>
          <Card id="assigned-products" title={`Assigned products (${count})`} description="Assign this add-on to products and optionally set a different price per product.">
            <AssignedProducts
              addOnName={addOn.name}
              priceCents={addOn.priceCents}
              assignments={addOn.products.map((p) => ({
                productId: p.productId,
                productName: p.product.name,
                status: p.product.status,
                priceOverride: centsToDollarInput(p.priceOverrideCents),
                enabled: p.enabled,
              }))}
              available={allProducts.filter((p) => !assignedIds.has(p.id))}
              assign={assignAddOnToProduct.bind(null, addOn.id)}
              update={updateAddOnAssignment.bind(null, addOn.id)}
              remove={removeAddOnFromProduct.bind(null, addOn.id)}
            />
          </Card>
        </div>
        <aside className="grid content-start gap-6">
          <Card title="Manage">
            <div className="grid gap-3">
              {archived ? (
                <ActionButton action={restoreAddOn.bind(null, addOn.id)} pendingLabel="Restoring…">
                  Restore add-on
                </ActionButton>
              ) : (
                <ConfirmAction
                  action={archiveAddOn.bind(null, addOn.id)}
                  label="Archive add-on"
                  title={`Archive “${addOn.name}”?`}
                  body="The add-on will be hidden from every product. Product assignments are kept so you can restore it later."
                  confirmLabel="Archive"
                  successMessage="Add-on archived."
                />
              )}
              {count === 0 ? (
                <ConfirmAction
                  action={deleteAddOn.bind(null, addOn.id)}
                  label="Delete permanently"
                  variant="danger"
                  title={`Delete “${addOn.name}”?`}
                  body="This permanently deletes the add-on. Existing quote requests keep their saved configuration."
                  confirmLabel="Delete"
                  redirectTo="/admin/add-ons"
                />
              ) : (
                <p className="text-xs text-neutral-500">
                  Assigned to {count} product{count === 1 ? "" : "s"}, so it can&apos;t be deleted. Remove it from those products first, or archive it.
                </p>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
