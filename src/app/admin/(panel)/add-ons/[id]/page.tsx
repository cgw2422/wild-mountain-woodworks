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
import { configuredAddOnUnitPrice } from "@/lib/pricing/engine";
import { loadAddOnPreview } from "@/lib/pricing/load";
import { formatCents } from "@/lib/money";
import type { ConfigAddOn } from "@/lib/pricing/types";
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
  const preview = await loadAddOnPreview(addOn.id);
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
                setsUnitPrice: g.setsUnitPrice,
              }))}
              available={libraryGroups.filter((g) => !attachedGroupIds.has(g.id))}
              attach={attachAddOnOptionGroup.bind(null, addOn.id)}
              update={updateAddOnOptionGroup.bind(null, addOn.id)}
              detach={detachAddOnOptionGroup.bind(null, addOn.id)}
              reorder={reorderAddOnOptionGroups.bind(null, addOn.id)}
            />
          </Card>
          {preview && preview.optionGroups.length ? <PricePreview addOn={preview} /> : null}
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

/**
 * What one configured unit costs, from the same calculation customers,
 * quotes, orders and invoices use — so a price entered twice (base price AND
 * a full price on a value) is obvious before a customer sees it.
 */
function PricePreview({ addOn }: { addOn: ConfigAddOn }) {
  const priceGroup = addOn.optionGroups.find((g) => g.setsUnitPrice);
  const lead = priceGroup ?? addOn.optionGroups[0]!;
  // Cheapest choice in every other group, so each row shows the lowest price for that value.
  const cheapest: Record<string, string> = {};
  for (const g of addOn.optionGroups) {
    const v = [...g.values].sort((a, b) => a.priceModifierCents - b.priceModifierCents)[0];
    if (v) cheapest[g.id] = v.id;
  }
  const rows = lead.values.map((v) => {
    const r = configuredAddOnUnitPrice(addOn, { ...cheapest, [lead.id]: v.id });
    return { value: v.displayName, unit: r.unitCents, others: r.choices.filter((c) => c.groupId !== lead.id).map((c) => c.value) };
  });
  // A few example quantities (always including 2 and the default), each simply unit × quantity.
  const qtys = [...new Set([1, 2, Math.max(addOn.defaultQuantity, 1)])].filter((q) => q <= addOn.maxQuantity).sort((a, b) => a - b);
  // Likely double entry: values that look like full unit prices added on top of a base price.
  const suspicious = !priceGroup && addOn.priceCents > 0 ? lead.values.filter((v) => v.priceModifierCents >= addOn.priceCents * 0.5) : [];
  return (
    <Card
      id="price-preview"
      title="Price per unit — preview"
      description={
        priceGroup
          ? `Price per unit = the chosen “${priceGroup.displayName}” price + the other choices' adjustments. The base price (${formatCents(addOn.priceCents)}) is not added. Total = price per unit × quantity.`
          : `Price per unit = base price ${formatCents(addOn.priceCents)} + each choice's adjustment. Total = price per unit × quantity.`
      }
    >
      {suspicious.length ? (
        <p role="alert" className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          “{suspicious[0]!.displayName}” in {lead.displayName} costs {formatCents(suspicious[0]!.priceModifierCents)} and is <strong>added on top of</strong> the {formatCents(addOn.priceCents)} base price, so one unit is{" "}
          {formatCents(addOn.priceCents + suspicious[0]!.priceModifierCents)}. If {formatCents(suspicious[0]!.priceModifierCents)} is the full price of one unit, turn on “Sets the price per unit” for {lead.displayName} above (or set the base price to $0).
        </p>
      ) : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th scope="col" className="py-2 pr-4 font-semibold">{lead.displayName}</th>
            {qtys.map((q) => (
              <th key={q} scope="col" className="py-2 pl-4 text-right font-semibold">
                {q === 1 ? "Price per unit" : `${q} units${q === addOn.defaultQuantity ? " (default)" : ""}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <tr key={r.value}>
              <th scope="row" className="py-2 pr-4 text-left font-normal">
                {r.value}
                {r.others.length ? <span className="block text-xs text-neutral-500">with {r.others.join(" · ")}</span> : null}
              </th>
              {qtys.map((q) => (
                <td key={q} className="py-2 pl-4 text-right tabular-nums">
                  {r.unit == null ? "—" : q === 1 ? formatCents(r.unit) : `${formatCents(r.unit * q)}`}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
