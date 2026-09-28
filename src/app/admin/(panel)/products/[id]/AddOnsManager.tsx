"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { centsToDollarInput, formatCents, parseDollarsToCents } from "@/lib/money";
import { MoveButtons, SortableList } from "@/components/admin/Sortable";
import { Badge, adminButton } from "@/components/admin/ui";
import type { AddOnState, RequiredOverride } from "../_lib/payloads";

export type LibraryAddOn = {
  id: string;
  name: string;
  priceCents: number;
  required: boolean;
  minQuantity: number;
  maxQuantity: number;
  active: boolean;
  archived: boolean;
  scope: string;
};

type Row = AddOnState & { id: string };

const inputCls =
  "block h-8 w-full rounded border border-neutral-300 bg-white px-2 text-sm tabular-nums focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 aria-[invalid=true]:border-red-500";

/**
 * Per-product add-on configuration, submitted with the product form as JSON
 * (`addOnsJson`) and saved with the main Save button.
 */
export function AddOnsManager({ library, initial }: { library: LibraryAddOn[]; initial: AddOnState[] }) {
  const libById = new Map(library.map((a) => [a.id, a]));
  const [rows, setRows] = useState<Row[]>(() => initial.filter((r) => libById.has(r.addOnId)).map((r) => ({ ...r, id: r.addOnId })));
  const [toAttach, setToAttach] = useState("");
  const selectId = useId();

  const payload: AddOnState[] = rows.map((r) => ({
    addOnId: r.addOnId,
    enabled: r.enabled,
    priceOverride: r.priceOverride,
    requiredOverride: r.requiredOverride,
    minQuantityOverride: r.minQuantityOverride,
    maxQuantityOverride: r.maxQuantityOverride,
  }));
  const attachable = library.filter((a) => !a.archived && !rows.some((r) => r.id === a.id));

  function patch(id: string, p: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  function attach() {
    if (!toAttach) return;
    setRows((prev) => [
      ...prev,
      { id: toAttach, addOnId: toAttach, enabled: true, priceOverride: "", requiredOverride: "inherit", minQuantityOverride: "", maxQuantityOverride: "" },
    ]);
    setToAttach("");
  }

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
    >
      <input type="hidden" name="addOnsJson" value={JSON.stringify(payload)} />
      {rows.length === 0 ? (
        <p className="mb-4 rounded border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">No add-ons attached. Attach reusable or product-specific add-ons below.</p>
      ) : (
        <SortableList
          items={rows}
          onReorder={setRows}
          className="mb-4 grid gap-3"
          itemClassName="rounded-md border border-neutral-200 bg-white"
          renderItem={(r, { handle, moveUp, moveDown }) => {
            const lib = libById.get(r.id)!;
            const priceInvalid = r.priceOverride.trim() !== "" && (Number.isNaN(parseDollarsToCents(r.priceOverride)) || (parseDollarsToCents(r.priceOverride) ?? 0) < 0);
            const minInvalid = r.minQuantityOverride.trim() !== "" && !/^\d+$/.test(r.minQuantityOverride.trim());
            const maxInvalid = r.maxQuantityOverride.trim() !== "" && !/^[1-9]\d*$/.test(r.maxQuantityOverride.trim());
            const base = `ao-${r.id}`;
            return (
              <div className={cn("p-2", (!r.enabled || !lib.active || lib.archived) && "bg-neutral-50")}>
                <div className="flex flex-wrap items-center gap-2">
                  {handle}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-neutral-900">
                      {lib.name}
                      {lib.scope === "PRODUCT_SPECIFIC" ? <Badge tone="violet" className="ml-2">Product-specific</Badge> : null}
                      {lib.archived ? <Badge tone="amber" className="ml-2">Archived</Badge> : !lib.active ? <Badge tone="amber" className="ml-2">Inactive</Badge> : null}
                    </p>
                    <p className="text-xs text-neutral-500">
                      Library: {formatCents(lib.priceCents)} · qty {lib.minQuantity}–{lib.maxQuantity} · {lib.required ? "required" : "optional"}
                      {lib.archived || !lib.active ? " · hidden on all products until restored" : ""}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-neutral-800">
                    <input type="checkbox" checked={r.enabled} onChange={(e) => patch(r.id, { enabled: e.target.checked })} className="h-4 w-4 accent-neutral-900" />
                    Enabled
                  </label>
                  <MoveButtons moveUp={moveUp} moveDown={moveDown} labelUp={`Move ${lib.name} up`} labelDown={`Move ${lib.name} down`} />
                  <Link href={`/admin/add-ons/${lib.id}`} target="_blank" className={adminButton.small} aria-label={`Edit ${lib.name} in the library (opens in a new tab)`}>
                    Edit ↗
                  </Link>
                  <button type="button" className={cn(adminButton.small, "text-red-700")} onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))} aria-label={`Detach ${lib.name}`}>
                    Detach
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3 px-1 pb-1 sm:grid-cols-4">
                  <div>
                    <label htmlFor={`${base}-price`} className="mb-1 block text-xs font-medium text-neutral-700">
                      Price
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-neutral-400">$</span>
                      <input
                        id={`${base}-price`}
                        value={r.priceOverride}
                        onChange={(e) => patch(r.id, { priceOverride: e.target.value })}
                        inputMode="decimal"
                        placeholder={centsToDollarInput(lib.priceCents)}
                        aria-invalid={priceInvalid || undefined}
                        className={cn(inputCls, "pl-5")}
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor={`${base}-req`} className="mb-1 block text-xs font-medium text-neutral-700">
                      Required
                    </label>
                    <select id={`${base}-req`} value={r.requiredOverride} onChange={(e) => patch(r.id, { requiredOverride: e.target.value as RequiredOverride })} className={inputCls}>
                      <option value="inherit">Inherit ({lib.required ? "required" : "optional"})</option>
                      <option value="required">Required</option>
                      <option value="optional">Optional</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`${base}-min`} className="mb-1 block text-xs font-medium text-neutral-700">
                      Min qty
                    </label>
                    <input
                      id={`${base}-min`}
                      value={r.minQuantityOverride}
                      onChange={(e) => patch(r.id, { minQuantityOverride: e.target.value })}
                      inputMode="numeric"
                      placeholder={String(lib.minQuantity)}
                      aria-invalid={minInvalid || undefined}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${base}-max`} className="mb-1 block text-xs font-medium text-neutral-700">
                      Max qty
                    </label>
                    <input
                      id={`${base}-max`}
                      value={r.maxQuantityOverride}
                      onChange={(e) => patch(r.id, { maxQuantityOverride: e.target.value })}
                      inputMode="numeric"
                      placeholder={String(lib.maxQuantity)}
                      aria-invalid={maxInvalid || undefined}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>
            );
          }}
        />
      )}
      <p className="mb-4 text-xs text-neutral-500">Blank fields inherit the add-on&apos;s library settings (shown as placeholders).</p>
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
        <div className="min-w-[14rem] flex-1">
          <label htmlFor={selectId} className="mb-1 block text-sm font-medium text-neutral-800">
            Attach an add-on
          </label>
          <select id={selectId} value={toAttach} onChange={(e) => setToAttach(e.target.value)} className={cn(inputCls, "h-9")} disabled={!attachable.length}>
            <option value="">{attachable.length ? "Choose an add-on…" : "No more add-ons available"}</option>
            {attachable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {formatCents(a.priceCents)}
                {a.scope === "PRODUCT_SPECIFIC" ? " (product-specific)" : ""}
                {!a.active ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className={adminButton.secondary} onClick={attach} disabled={!toAttach}>
          Attach
        </button>
        <Link href="/admin/add-ons/new" target="_blank" className={adminButton.ghost}>
          New add-on ↗
        </Link>
      </div>
    </div>
  );
}
