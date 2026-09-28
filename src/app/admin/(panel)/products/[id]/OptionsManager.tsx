"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { centsToDollarInput, formatModifier, parseDollarsToCents } from "@/lib/money";
import { MoveButtons, SortableList } from "@/components/admin/Sortable";
import { Badge, adminButton } from "@/components/admin/ui";
import type { OptionGroupState, OptionValueState, RequiredOverride } from "../_lib/payloads";

export type LibraryOptionValue = {
  id: string;
  name: string;
  displayName: string;
  priceModifierCents: number;
  displayOrder: number;
  active: boolean;
  isCustom: boolean;
};
export type LibraryOptionGroup = {
  id: string;
  name: string;
  displayName: string;
  inputType: string;
  required: boolean;
  active: boolean;
  values: LibraryOptionValue[];
};

type GroupState = {
  id: string; // optionGroupId (stable key for sorting)
  requiredOverride: RequiredOverride;
  displayNameOverride: string;
  values: Record<string, OptionValueState>;
};

const inherit = (optionValueId: string): OptionValueState => ({ optionValueId, enabled: true, priceOverride: "", displayOrderOverride: "", isDefault: false });
const isInherited = (v: OptionValueState) => v.enabled && v.priceOverride.trim() === "" && v.displayOrderOverride.trim() === "" && !v.isDefault;

const inputCls =
  "block h-8 w-full rounded border border-neutral-300 bg-white px-2 text-sm tabular-nums focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 aria-[invalid=true]:border-red-500 disabled:bg-neutral-50";

/**
 * Per-product option configuration. State is submitted with the product
 * form as JSON (`optionsJson`) and saved with the main Save button.
 */
export function OptionsManager({ library, initial }: { library: LibraryOptionGroup[]; initial: OptionGroupState[] }) {
  const libById = new Map(library.map((g) => [g.id, g]));
  const [groups, setGroups] = useState<GroupState[]>(() =>
    initial
      .filter((g) => libById.has(g.optionGroupId))
      .map((g) => ({
        id: g.optionGroupId,
        requiredOverride: g.requiredOverride,
        displayNameOverride: g.displayNameOverride,
        values: Object.fromEntries(g.values.map((v) => [v.optionValueId, v])),
      })),
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [toAttach, setToAttach] = useState("");
  const selectId = useId();

  const payload: OptionGroupState[] = groups.map((g) => ({
    optionGroupId: g.id,
    requiredOverride: g.requiredOverride,
    displayNameOverride: g.displayNameOverride,
    values: Object.values(g.values).filter((v) => !isInherited(v)),
  }));
  const attachable = library.filter((g) => !groups.some((s) => s.id === g.id));

  function patchGroup(id: string, patch: Partial<GroupState>) {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }

  function patchValue(groupId: string, valueId: string, patch: Partial<OptionValueState>) {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const values = { ...g.values };
        if (patch.isDefault) {
          for (const k of Object.keys(values)) values[k] = { ...values[k]!, isDefault: false };
        }
        values[valueId] = { ...(values[valueId] ?? inherit(valueId)), ...patch };
        return { ...g, values };
      }),
    );
  }

  function clearDefault(groupId: string) {
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, values: Object.fromEntries(Object.entries(g.values).map(([k, v]) => [k, { ...v, isDefault: false }])) } : g)),
    );
  }

  function attach() {
    if (!toAttach || !libById.has(toAttach)) return;
    setGroups((prev) => [...prev, { id: toAttach, requiredOverride: "inherit", displayNameOverride: "", values: {} }]);
    setExpanded((prev) => new Set(prev).add(toAttach));
    setToAttach("");
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
    >
      <input type="hidden" name="optionsJson" value={JSON.stringify(payload)} />

      {groups.length === 0 ? (
        <p className="mb-4 rounded border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">
          No options attached. Attach option groups from the library below (e.g. size, wood species, finish).
        </p>
      ) : (
        <SortableList
          items={groups}
          onReorder={setGroups}
          className="mb-4 grid gap-3"
          itemClassName="rounded-md border border-neutral-200 bg-white"
          renderItem={(g, { handle, moveUp, moveDown }) => {
            const lib = libById.get(g.id)!;
            const open = expanded.has(g.id);
            const values = [...lib.values].sort((a, b) => a.displayOrder - b.displayOrder);
            const states = values.map((v) => g.values[v.id] ?? inherit(v.id));
            const offered = values.filter((v, i) => v.active && states[i]!.enabled).length;
            const customized = states.filter((s) => !isInherited(s)).length;
            const hasDefault = states.some((s) => s.isDefault);
            const panelId = `og-panel-${g.id}`;
            return (
              <div>
                <div className="flex flex-wrap items-center gap-2 px-2 py-2">
                  {handle}
                  <button
                    type="button"
                    onClick={() => toggle(g.id)}
                    aria-expanded={open}
                    aria-controls={panelId}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left hover:bg-neutral-50"
                  >
                    <svg viewBox="0 0 16 16" className={cn("h-4 w-4 shrink-0 text-neutral-500 transition", open && "rotate-90")} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-neutral-900">
                        {g.displayNameOverride.trim() || lib.displayName}
                        <span className="ml-2 text-xs font-normal text-neutral-500">{lib.name}</span>
                      </span>
                      <span className="block text-xs text-neutral-500">
                        {offered} of {values.length} values offered{customized ? ` · ${customized} customized` : ""}
                      </span>
                    </span>
                  </button>
                  {!lib.active ? <Badge tone="amber">Inactive in library</Badge> : null}
                  <MoveButtons moveUp={moveUp} moveDown={moveDown} labelUp={`Move ${lib.name} up`} labelDown={`Move ${lib.name} down`} />
                  <button
                    type="button"
                    className={cn(adminButton.small, "text-red-700")}
                    onClick={() => setGroups((prev) => prev.filter((x) => x.id !== g.id))}
                    aria-label={`Detach ${lib.name} from this product`}
                  >
                    Detach
                  </button>
                </div>

                {open ? (
                  <div id={panelId} className="border-t border-neutral-100 px-4 py-4">
                    {!lib.active ? (
                      <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">This group is inactive in the library, so it&apos;s hidden on every product until it&apos;s reactivated.</p>
                    ) : null}
                    <div className="mb-4 grid gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`${panelId}-dn`} className="mb-1 block text-sm font-medium text-neutral-800">
                          Display name on this product
                        </label>
                        <input
                          id={`${panelId}-dn`}
                          value={g.displayNameOverride}
                          onChange={(e) => patchGroup(g.id, { displayNameOverride: e.target.value })}
                          placeholder={lib.displayName}
                          maxLength={120}
                          className={cn(inputCls, "h-9")}
                        />
                        <p className="mt-1 text-xs text-neutral-500">Blank = “{lib.displayName}” from the library.</p>
                      </div>
                      <div>
                        <label htmlFor={`${panelId}-req`} className="mb-1 block text-sm font-medium text-neutral-800">
                          Required
                        </label>
                        <select
                          id={`${panelId}-req`}
                          value={g.requiredOverride}
                          onChange={(e) => patchGroup(g.id, { requiredOverride: e.target.value as RequiredOverride })}
                          className={cn(inputCls, "h-9")}
                        >
                          <option value="inherit">Inherit ({lib.required ? "required" : "optional"})</option>
                          <option value="required">Required</option>
                          <option value="optional">Optional</option>
                        </select>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded border border-neutral-200">
                      <table className="min-w-full text-sm">
                        <caption className="sr-only">Values for {lib.name}</caption>
                        <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                          <tr>
                            <th scope="col" className="px-3 py-2">Offer</th>
                            <th scope="col" className="px-3 py-2">Value</th>
                            <th scope="col" className="px-3 py-2">Price (blank = library)</th>
                            <th scope="col" className="px-3 py-2">Order</th>
                            <th scope="col" className="px-3 py-2">Default</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                          {values.map((v, i) => {
                            const s = states[i]!;
                            const priceInvalid = s.priceOverride.trim() !== "" && Number.isNaN(parseDollarsToCents(s.priceOverride));
                            const orderInvalid = s.displayOrderOverride.trim() !== "" && !/^-?\d+$/.test(s.displayOrderOverride.trim());
                            return (
                              <tr key={v.id} className={cn(!v.active && "bg-neutral-50 text-neutral-400")}>
                                <td className="px-3 py-2">
                                  <input
                                    type="checkbox"
                                    checked={s.enabled}
                                    onChange={(e) => patchValue(g.id, v.id, { enabled: e.target.checked, ...(e.target.checked ? {} : { isDefault: false }) })}
                                    aria-label={`Offer ${v.displayName} on this product`}
                                    className="h-4 w-4 accent-neutral-900"
                                  />
                                </td>
                                <td className="min-w-[10rem] px-3 py-2">
                                  <span className={cn("font-medium", v.active ? "text-neutral-900" : "text-neutral-400")}>{v.displayName}</span>
                                  {v.isCustom ? <Badge tone="violet" className="ml-2">Custom</Badge> : null}
                                  {!v.active ? <span className="block text-xs">Inactive in library — hidden on all products</span> : null}
                                  {!s.enabled && v.active ? <span className="block text-xs text-neutral-500">Not offered on this product</span> : null}
                                </td>
                                <td className="w-40 px-3 py-2">
                                  <div className="relative">
                                    <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-neutral-400">$</span>
                                    <input
                                      value={s.priceOverride}
                                      onChange={(e) => patchValue(g.id, v.id, { priceOverride: e.target.value })}
                                      inputMode="decimal"
                                      placeholder={centsToDollarInput(v.priceModifierCents)}
                                      aria-label={`Price modifier for ${v.displayName} (library: ${formatModifier(v.priceModifierCents) || "$0"})`}
                                      aria-invalid={priceInvalid || undefined}
                                      disabled={!s.enabled}
                                      className={cn(inputCls, "pl-5")}
                                    />
                                  </div>
                                  {priceInvalid ? <span className="text-xs text-red-600">Enter an amount like 150 or -50</span> : null}
                                </td>
                                <td className="w-24 px-3 py-2">
                                  <input
                                    value={s.displayOrderOverride}
                                    onChange={(e) => patchValue(g.id, v.id, { displayOrderOverride: e.target.value })}
                                    inputMode="numeric"
                                    placeholder={String(v.displayOrder)}
                                    aria-label={`Display order for ${v.displayName} (library: ${v.displayOrder})`}
                                    aria-invalid={orderInvalid || undefined}
                                    disabled={!s.enabled}
                                    className={inputCls}
                                  />
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <input
                                    type="radio"
                                    name={`default-${g.id}`}
                                    checked={s.isDefault}
                                    onChange={() => patchValue(g.id, v.id, { isDefault: true })}
                                    disabled={!s.enabled || !v.active}
                                    aria-label={`Make ${v.displayName} the default selection`}
                                    className="h-4 w-4 accent-neutral-900"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
                      <span>
                        {hasDefault
                          ? "The default is pre-selected on the product page."
                          : lib.required || g.requiredOverride === "required"
                            ? "No default: the first non-custom value is pre-selected."
                            : "No default: nothing is pre-selected."}
                      </span>
                      <span className="flex gap-3">
                        {hasDefault ? (
                          <button type="button" className="underline hover:text-neutral-900" onClick={() => clearDefault(g.id)}>
                            Clear default
                          </button>
                        ) : null}
                        {customized ? (
                          <button type="button" className="underline hover:text-neutral-900" onClick={() => patchGroup(g.id, { values: {} })}>
                            Reset values to library settings
                          </button>
                        ) : null}
                        <Link href={`/admin/options/${lib.id}`} target="_blank" className="underline hover:text-neutral-900">
                          Edit “{lib.name}” in the library ↗
                        </Link>
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          }}
        />
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
        <div className="min-w-[14rem] flex-1">
          <label htmlFor={selectId} className="mb-1 block text-sm font-medium text-neutral-800">
            Attach an option group
          </label>
          <select id={selectId} value={toAttach} onChange={(e) => setToAttach(e.target.value)} className={cn(inputCls, "h-9")} disabled={!attachable.length}>
            <option value="">{attachable.length ? "Choose from the library…" : "All option groups are attached"}</option>
            {attachable.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.name !== g.displayName ? ` — “${g.displayName}”` : ""}
                {!g.active ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className={adminButton.secondary} onClick={attach} disabled={!toAttach}>
          Attach
        </button>
        <Link href="/admin/options/new" target="_blank" className={adminButton.ghost}>
          New option group ↗
        </Link>
      </div>
    </div>
  );
}
