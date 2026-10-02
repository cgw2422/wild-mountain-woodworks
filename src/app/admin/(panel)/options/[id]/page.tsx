import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Badge, Card, PageHeader, StatusBadge, formatDate } from "@/components/admin/ui";
import { ActionButton, ConfirmAction } from "@/components/admin/forms";
import { toImageValue } from "../../products/_lib/media";
import { RunActionButton } from "@/components/admin/catalog/RunActionButton";
import { DeleteCatalogButton } from "@/components/admin/catalog/DeleteCatalogButton";
import {
  deleteOptionGroup,
  deleteOptionValue,
  duplicateOptionGroup,
  duplicateOptionValue,
  reorderOptionValues,
  saveOptionValue,
  setOptionGroupActive,
  updateOptionGroup,
} from "../actions";
import { inputTypeLabel } from "../input-types";
import { OptionGroupForm } from "../OptionGroupForm";
import { ValuesEditor } from "./ValuesEditor";

export const metadata: Metadata = { title: "Edit option group" };
export const dynamic = "force-dynamic";

export default async function OptionGroupPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const group = await prisma.optionGroup.findUnique({
    where: { id },
    include: {
      values: {
        orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
        include: { image: true, _count: { select: { productOverrides: true } }, priceRules: { orderBy: { displayOrder: "asc" }, select: { dependsOnValueId: true, priceModifierCents: true } } },
      },
      products: {
        include: { product: { select: { id: true, name: true, status: true } } },
        orderBy: { product: { name: "asc" } },
      },
    },
  });
  if (!group) notFound();
  const usedBy = group.products.length;
  // Conditional prices can depend on a value of any OTHER option group.
  const ruleGroups = await prisma.optionGroup.findMany({
    where: { id: { not: group.id } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, values: { orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }], select: { id: true, displayName: true, active: true } } },
  });

  return (
    <>
      <PageHeader
        title={group.name}
        breadcrumbs={[{ label: "Options", href: "/admin/options" }, { label: group.name }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {group.active ? <Badge tone="green">Active</Badge> : <Badge tone="amber">Inactive</Badge>}
            <span>
              {inputTypeLabel(group.inputType)} · {usedBy ? `Used by ${usedBy} product${usedBy === 1 ? "" : "s"}` : "Not used by any product"} · Updated {formatDate(group.updatedAt)}
            </span>
          </span>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid min-w-0 content-start gap-6">
          <OptionGroupForm
            mode="edit"
            action={updateOptionGroup.bind(null, group.id)}
            values={{
              name: group.name,
              displayName: group.displayName,
              description: group.description ?? "",
              inputType: group.inputType,
              required: group.required,
              active: group.active,
            }}
          />
          <Card title={`Values (${group.values.length})`} description="Price modifiers here are the defaults. Each product can disable values or override their price, and a value can have conditional prices that depend on another option (e.g. Match Tabletop priced by the tabletop wood).">
            <ValuesEditor
              inputType={group.inputType}
              save={saveOptionValue.bind(null, group.id)}
              remove={deleteOptionValue.bind(null, group.id)}
              duplicate={duplicateOptionValue.bind(null, group.id)}
              reorder={reorderOptionValues.bind(null, group.id)}
              ruleGroups={ruleGroups.filter((g) => g.values.length)}
              values={group.values.map((v) => ({
                id: v.id,
                name: v.name,
                displayName: v.displayName,
                description: v.description ?? "",
                priceModifierCents: v.priceModifierCents,
                isCustom: v.isCustom,
                quantityEnabled: v.quantityEnabled,
                quantityMin: v.quantityMin,
                quantityMax: v.quantityMax,
                quantityStep: v.quantityStep,
                quantityDefault: v.quantityDefault,
                active: v.active,
                swatchColor: v.swatchColor ?? "",
                image: toImageValue(v.image),
                overrideCount: v._count.productOverrides,
                priceRules: v.priceRules,
              }))}
            />
          </Card>
        </div>
        <aside className="grid content-start gap-6">
          <Card title={`Used by ${usedBy} product${usedBy === 1 ? "" : "s"}`}>
            {usedBy === 0 ? (
              <p className="text-sm text-neutral-500">Attach this group from a product&apos;s Options section.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {group.products.map((pog) => (
                  <li key={pog.id} className="flex items-center justify-between gap-2">
                    <Link href={`/admin/products/${pog.product.id}#options`} className="block truncate py-3 text-neutral-800 hover:underline">
                      {pog.product.name}
                    </Link>
                    <StatusBadge status={pog.product.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Manage">
            <div className="grid gap-3">
              <RunActionButton
                action={duplicateOptionGroup.bind(null, group.id)}
                navigatePrefix="/admin/options/"
                confirm={{
                  title: `Duplicate “${group.name}”?`,
                  body: `Creates a new group “Copy of ${group.name}” with all ${group.values.length} value${group.values.length === 1 ? "" : "s"} — prices, images, swatches and settings. It isn't attached to any product, so the site doesn't change until you attach it. Unsaved edits on this page are not copied.`,
                  confirmLabel: "Duplicate",
                }}
                pendingLabel="Duplicating…"
              >
                Duplicate group
              </RunActionButton>
              {group.active ? (
                <ConfirmAction
                  action={setOptionGroupActive.bind(null, group.id, false)}
                  label="Deactivate"
                  title={`Deactivate “${group.name}”?`}
                  body="The group will be hidden on every product that uses it. Product settings are kept, so you can reactivate it later."
                  confirmLabel="Deactivate"
                  successMessage="Option group deactivated."
                />
              ) : (
                <ActionButton action={setOptionGroupActive.bind(null, group.id, true)} pendingLabel="Activating…">
                  Activate
                </ActionButton>
              )}
              <DeleteCatalogButton
                kind="optionGroup"
                id={group.id}
                noun="option group"
                name={group.name}
                action={deleteOptionGroup.bind(null, group.id)}
                redirectTo="/admin/options"
                className="h-10 justify-center text-sm"
                hideHint="To hide it for now and keep product settings, deactivate it instead."
              />
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
