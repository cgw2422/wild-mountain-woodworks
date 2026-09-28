"use client";

import Link from "next/link";
import type { ActionResult } from "@/lib/admin/types";
import { formatCents } from "@/lib/money";
import { ActionForm, ConfirmAction, MoneyInput, Select, SubmitButton, Toggle } from "@/components/admin/forms";
import { StatusBadge } from "@/components/admin/ui";

export type Assignment = { productId: string; productName: string; status: string; priceOverride: string; enabled: boolean };

export function AssignedProducts({
  addOnName,
  priceCents,
  assignments,
  available,
  assign,
  update,
  remove,
}: {
  addOnName: string;
  priceCents: number;
  assignments: Assignment[];
  available: Array<{ id: string; name: string; status: string }>;
  assign: (data: FormData) => Promise<ActionResult>;
  update: (productId: string, data: FormData) => Promise<ActionResult>;
  remove: (productId: string) => Promise<ActionResult>;
}) {
  return (
    <div className="grid gap-5">
      {assignments.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">
          Not assigned to any product yet. Assign it below or from a product&apos;s Add-ons section.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
          {assignments.map((a) => (
            <li key={a.productId} className="px-4 py-3">
              <ActionForm action={(data) => update(a.productId, data)} successMessage="Saved." className="flex flex-wrap items-end gap-x-4 gap-y-3">
                <div className="min-w-[10rem] flex-1 self-center">
                  <Link href={`/admin/products/${a.productId}#add-ons`} className="font-medium text-neutral-900 hover:underline">
                    {a.productName}
                  </Link>
                  <div className="mt-1">
                    <StatusBadge status={a.status} />
                  </div>
                </div>
                <MoneyInput
                  label="Price on this product"
                  name="priceOverride"
                  defaultValue={a.priceOverride}
                  placeholder={`${(priceCents / 100).toFixed(0)} (default)`}
                  wrapperClassName="w-44"
                />
                <Toggle label="Enabled" name="enabled" defaultChecked={a.enabled} className="pb-2" />
                <div className="flex gap-2 pb-0.5">
                  <SubmitButton variant="small">Save</SubmitButton>
                  <ConfirmAction
                    action={() => remove(a.productId)}
                    label="Remove"
                    variant="small"
                    title={`Remove “${addOnName}” from ${a.productName}?`}
                    body="Customers will no longer see this add-on on that product. Existing quotes keep their saved configuration."
                    confirmLabel="Remove"
                    successMessage="Removed."
                  />
                </div>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-neutral-500">Leave the price blank to use the default price of {formatCents(priceCents)}.</p>

      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
        <h3 className="mb-3 text-sm font-semibold text-neutral-900">Assign to a product</h3>
        {available.length === 0 ? (
          <p className="text-sm text-neutral-500">This add-on is already assigned to every product.</p>
        ) : (
          <ActionForm action={assign} successMessage="Assigned." resetOnSuccess className="flex flex-wrap items-end gap-3">
            <Select
              label="Product"
              name="productId"
              placeholder="Choose a product…"
              options={available.map((p) => ({ value: p.id, label: p.status === "ACTIVE" ? p.name : `${p.name} (${p.status.toLowerCase()})` }))}
              wrapperClassName="min-w-[14rem] flex-1"
            />
            <MoneyInput label="Price override (optional)" name="priceOverride" placeholder={`${(priceCents / 100).toFixed(0)} (default)`} wrapperClassName="w-48" />
            <SubmitButton pendingLabel="Assigning…">Assign</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
