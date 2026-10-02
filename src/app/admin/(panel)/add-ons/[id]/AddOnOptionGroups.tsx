"use client";

import Link from "next/link";
import type { ActionResult } from "@/lib/admin/types";
import { ActionForm, ConfirmAction, Select, SubmitButton, TextInput, Toggle } from "@/components/admin/forms";
import { Badge } from "@/components/admin/ui";
import { SortableRows } from "@/components/admin/catalog/SortableRows";
import { DeleteCatalogButton } from "@/components/admin/catalog/DeleteCatalogButton";
import { formatCents, formatModifier } from "@/lib/money";

export type AttachedGroup = {
  optionGroupId: string;
  name: string;
  displayName: string;
  inputType: string;
  active: boolean;
  required: boolean;
  valueCount: number;
  displayNameOverride: string;
  requiredOverride: "inherit" | "required" | "optional";
  setsUnitPrice: boolean;
  /** The group's choices (library values), e.g. the chair styles. */
  values: Array<{ id: string; displayName: string; active: boolean; priceModifierCents: number }>;
};

const INPUT_LABELS: Record<string, string> = { IMAGE: "Image cards", SWATCH: "Swatches", BUTTONS: "Buttons", DROPDOWN: "Dropdown", RADIO: "Radio buttons" };

/**
 * The add-on's own configuration: option groups from the shared library
 * (e.g. Chair Style, Wood Species, Chair Finish, Seat Finish), in the order
 * customers see them. Values (name, price adjustment, image/swatch, order,
 * active) are managed on each group's page in Options.
 */
export function AddOnOptionGroups({
  groups,
  available,
  attach,
  update,
  detach,
  reorder,
  deleteChoice,
}: {
  groups: AttachedGroup[];
  /** Delete one choice (library value) of a group, e.g. a chair style — everywhere the group is used. */
  deleteChoice: (groupId: string, valueId: string) => Promise<ActionResult>;
  available: Array<{ id: string; name: string; displayName: string; active: boolean }>;
  attach: (data: FormData) => Promise<ActionResult>;
  update: (optionGroupId: string, data: FormData) => Promise<ActionResult>;
  detach: (optionGroupId: string) => Promise<ActionResult>;
  reorder: (ids: string[]) => Promise<ActionResult>;
}) {
  return (
    <div className="grid gap-5">
      {groups.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">
          This is a simple add-on (price × quantity). Add option groups below to make it configurable — customers then choose each group (e.g. style, wood, finishes) and the price per unit is the base price plus each choice&apos;s adjustment.
        </p>
      ) : (
        <SortableRows
          onSave={reorder}
          saveLabel="Save group order"
          hint="Customers see the first group, then the quantity, then the rest — in this order. Drag (or use the arrows), then save."
          rows={groups.map((g) => ({
            id: g.optionGroupId,
            label: g.displayNameOverride || g.displayName,
            content: (
              <ActionForm action={(data) => update(g.optionGroupId, data)} successMessage="Saved." className="flex flex-wrap items-end gap-x-4 gap-y-3">
                <div className="min-w-[12rem] flex-1 self-center">
                  <Link href={`/admin/options/${g.optionGroupId}`} className="block py-2 font-medium text-neutral-900 hover:underline">
                    {g.name}
                  </Link>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                    {INPUT_LABELS[g.inputType] ?? g.inputType} · {g.valueCount} value{g.valueCount === 1 ? "" : "s"}
                    {!g.active ? <Badge tone="amber">Inactive — hidden</Badge> : null}
                    {g.setsUnitPrice ? <Badge tone="blue">Sets price per unit</Badge> : null}
                  </span>
                </div>
                <TextInput label="Label on this add-on" name="displayNameOverride" defaultValue={g.displayNameOverride} placeholder={g.displayName} maxLength={120} wrapperClassName="w-52" />
                <Select
                  label="Required"
                  name="requiredOverride"
                  defaultValue={g.requiredOverride}
                  options={[
                    { value: "inherit", label: `Default (${g.required ? "required" : "optional"})` },
                    { value: "required", label: "Required" },
                    { value: "optional", label: "Optional" },
                  ]}
                  wrapperClassName="w-52"
                />
                <Toggle
                  label="Sets the price per unit"
                  name="setsUnitPrice"
                  defaultChecked={g.setsUnitPrice}
                  description="Each value's price is the full price of one unit (e.g. X Back = $192.50 per chair). The add-on base price is then not added."
                  className="w-full pb-1"
                />
                {g.values.length ? (
                  <details className="w-full rounded border border-neutral-100 px-3 py-2 text-sm">
                    <summary className="cursor-pointer text-neutral-700">
                      Choices ({g.values.length}) — edit prices and images in{" "}
                      <Link href={`/admin/options/${g.optionGroupId}`} className="underline">
                        Options
                      </Link>
                    </summary>
                    <ul className="mt-2 divide-y divide-neutral-100">
                      {g.values.map((v) => (
                        <li key={v.id} className="flex items-center justify-between gap-2 py-1">
                          <span className={v.active ? "text-neutral-800" : "text-neutral-400"}>
                            {v.displayName}
                            <span className="ml-2 text-xs text-neutral-500">{g.setsUnitPrice ? `${formatCents(v.priceModifierCents)} each` : formatModifier(v.priceModifierCents) || "No price change"}</span>
                            {!v.active ? <span className="ml-2 text-xs">(inactive)</span> : null}
                          </span>
                          <DeleteCatalogButton
                            kind="optionValue"
                            id={v.id}
                            noun="choice"
                            name={v.displayName}
                            iconOnly
                            action={() => deleteChoice(g.optionGroupId, v.id)}
                            hideHint="To hide it for now, make it inactive in Options instead."
                          />
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                <div className="flex gap-2 pb-0.5">
                  <SubmitButton variant="small">Save</SubmitButton>
                  <ConfirmAction
                    action={() => detach(g.optionGroupId)}
                    label="Remove"
                    variant="small"
                    title={`Remove “${g.name}” from this add-on?`}
                    body="Customers won't be asked this any more. The group stays in the option library, and saved quotes keep their configuration."
                    confirmLabel="Remove"
                    successMessage="Removed."
                  />
                </div>
              </ActionForm>
            ),
          }))}
        />
      )}

      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
        <h3 className="mb-1 text-sm font-semibold text-neutral-900">Add an option group</h3>
        <p className="mb-3 text-xs text-neutral-500">
          Create add-on–specific groups (e.g. “Chair Style”, “Chair Wood Species”) in{" "}
          <Link href="/admin/options/new" className="underline">
            Options → New group
          </Link>
          , give each value its image or swatch and price adjustment, then add the group here.
        </p>
        {available.length === 0 ? (
          <p className="text-sm text-neutral-500">Every option group is already part of this add-on.</p>
        ) : (
          <ActionForm action={attach} successMessage="Added." resetOnSuccess className="flex flex-wrap items-end gap-3">
            <Select
              label="Option group"
              name="optionGroupId"
              placeholder="Choose a group…"
              options={available.map((g) => ({ value: g.id, label: `${g.name}${g.displayName !== g.name ? ` (${g.displayName})` : ""}${g.active ? "" : " — inactive"}` }))}
              wrapperClassName="min-w-[16rem] flex-1"
            />
            <SubmitButton pendingLabel="Adding…">Add group</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
