"use client";

import { useState } from "react";
import Image from "next/image";
import type { ActionResult } from "@/lib/admin/types";
import { centsToDollarInput, formatModifier } from "@/lib/money";
import { ActionForm, ConfirmAction, Dialog, MoneyInput, SubmitButton, TextArea, TextInput, Toggle } from "@/components/admin/forms";
import { Badge, EmptyState, adminButton } from "@/components/admin/ui";
import { ImageField, type ImageValue } from "@/components/admin/media/ImageField";
import { ColorField } from "@/components/admin/catalog/ColorField";
import { SortableRows } from "@/components/admin/catalog/SortableRows";

export type ValueRow = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  priceModifierCents: number;
  isCustom: boolean;
  active: boolean;
  swatchColor: string;
  image: ImageValue | null;
  overrideCount: number;
};

export function ValuesEditor({
  inputType,
  values,
  save,
  remove,
  reorder,
}: {
  inputType: string;
  values: ValueRow[];
  save: (valueId: string | null, data: FormData) => Promise<ActionResult>;
  remove: (valueId: string) => Promise<ActionResult>;
  reorder: (ids: string[]) => Promise<ActionResult>;
}) {
  const [editing, setEditing] = useState<ValueRow | "new" | null>(null);
  const current = editing === "new" ? null : editing;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-600">
          {inputType === "IMAGE"
            ? "This group displays image tiles — give every value an image."
            : inputType === "SWATCH"
              ? "This group displays color swatches — give every value a swatch color (or an image)."
              : "Values appear in this order unless a product overrides it."}
        </p>
        <button type="button" className={adminButton.primary} onClick={() => setEditing("new")}>
          Add value
        </button>
      </div>

      {values.length === 0 ? (
        <EmptyState
          title="No values yet"
          description="Add the choices customers pick from, e.g. “Walnut”, “White Oak”."
          action={
            <button type="button" className={adminButton.primary} onClick={() => setEditing("new")}>
              Add the first value
            </button>
          }
        />
      ) : (
        <SortableRows
          onSave={reorder}
          saveLabel="Save value order"
          rows={values.map((v) => ({
            id: v.id,
            label: v.displayName,
            content: (
              <div className={`flex flex-wrap items-center gap-3 ${v.active ? "" : "opacity-60"}`}>
                <ValueThumb value={v} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-neutral-900">
                    {v.displayName}
                    {v.name !== v.displayName ? <span className="ml-2 text-xs font-normal text-neutral-500">({v.name})</span> : null}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {v.priceModifierCents ? formatModifier(v.priceModifierCents) : "No price change"}
                    {v.overrideCount ? ` · customized on ${v.overrideCount} product${v.overrideCount === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {v.isCustom ? <Badge tone="violet">Custom</Badge> : null}
                  {!v.active ? <Badge tone="amber">Inactive</Badge> : null}
                  {inputType === "IMAGE" && !v.image ? <Badge tone="red">No image</Badge> : null}
                  {inputType === "SWATCH" && !v.swatchColor && !v.image ? <Badge tone="red">No swatch</Badge> : null}
                  <button type="button" className={adminButton.small} onClick={() => setEditing(v)}>
                    Edit
                  </button>
                  <ConfirmAction
                    action={() => remove(v.id)}
                    label="Delete"
                    variant="small"
                    title={`Delete “${v.displayName}”?`}
                    body={
                      <div className="space-y-2">
                        <p>This removes the value from the library{v.overrideCount ? ` and its per-product settings on ${v.overrideCount} product${v.overrideCount === 1 ? "" : "s"}` : ""}.</p>
                        <p>Existing quote requests keep their saved configuration snapshot, so past quotes still show this choice.</p>
                        <p className="text-neutral-500">Tip: set the value to inactive instead if you may offer it again.</p>
                      </div>
                    }
                    confirmLabel="Delete value"
                    successMessage="Value deleted."
                  />
                </div>
              </div>
            ),
          }))}
        />
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? `Edit “${current.displayName}”` : "Add value"} size="lg">
        {editing !== null ? (
          <ActionForm
            key={current?.id ?? "new"}
            action={(data) => save(current?.id ?? null, data)}
            successMessage={current ? "Value saved." : "Value added."}
            onSuccess={() => setEditing(null)}
            className="grid gap-4 sm:grid-cols-2"
          >
            <TextInput label="Display name" name="displayName" required defaultValue={current?.displayName} maxLength={120} placeholder="e.g. Walnut" help="Shown to customers." />
            <TextInput
              label="Internal name"
              name="name"
              defaultValue={current?.name}
              maxLength={120}
              placeholder="Defaults to the display name"
              help="Unique within this group. Admin-only."
            />
            <TextArea label="Description" name="description" defaultValue={current?.description} rows={2} maxLength={1000} wrapperClassName="sm:col-span-2" help="Optional. Shown in radio lists and tooltips." />
            <MoneyInput
              label="Price modifier"
              name="priceModifier"
              defaultValue={centsToDollarInput(current?.priceModifierCents ?? 0)}
              help="Added to the base price. Use a negative amount (e.g. -50) for a discount. 0 = no change."
            />
            <ColorField name="swatchColor" label="Swatch color" defaultValue={current?.swatchColor} help={inputType === "SWATCH" ? "Shown as the swatch for this value." : "Used when the group displays color swatches."} />
            <ImageField
              name="imageId"
              label="Image"
              slot="swatch"
              value={current?.image ?? null}
              compact
              className="sm:col-span-2"
              help={inputType === "IMAGE" ? "Shown as the tile for this value." : "Used when the group displays image tiles (also overrides the swatch color)."}
            />
            <div className="grid gap-3 sm:col-span-2">
              <Toggle
                label="Custom value"
                name="isCustom"
                defaultChecked={current?.isCustom ?? false}
                description="e.g. “Custom size”. Customers are asked to describe what they want and the quote is flagged as custom."
              />
              <Toggle label="Active" name="active" defaultChecked={current?.active ?? true} description="Inactive values are hidden on every product." />
            </div>
            <div className="flex justify-end gap-2 border-t border-neutral-200 pt-4 sm:col-span-2">
              <button type="button" className={adminButton.secondary} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <SubmitButton>{current ? "Save value" : "Add value"}</SubmitButton>
            </div>
          </ActionForm>
        ) : null}
      </Dialog>
    </div>
  );
}

function ValueThumb({ value }: { value: ValueRow }) {
  if (value.image) {
    return (
      <span className="relative block h-10 w-10 shrink-0 overflow-hidden rounded border border-neutral-200 bg-neutral-100">
        <Image src={value.image.url} alt="" fill sizes="40px" className="object-cover" style={{ objectPosition: `${value.image.focalX}% ${value.image.focalY}%` }} />
      </span>
    );
  }
  if (value.swatchColor) {
    return <span aria-hidden="true" className="block h-10 w-10 shrink-0 rounded-full border border-neutral-300" style={{ backgroundColor: value.swatchColor }} />;
  }
  return <span aria-hidden="true" className="block h-10 w-10 shrink-0 rounded border border-dashed border-neutral-300 bg-neutral-50" />;
}
