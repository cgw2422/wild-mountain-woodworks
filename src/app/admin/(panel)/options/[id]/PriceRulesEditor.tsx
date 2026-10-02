"use client";

import { useRef, useState } from "react";
import { centsToDollarInput } from "@/lib/money";
import { useAdminForm } from "@/components/admin/forms";
import { adminButton } from "@/components/admin/ui";

/** Another option group a rule can depend on, with its values. */
export type RuleGroup = { id: string; name: string; values: Array<{ id: string; displayName: string; active: boolean }> };
export type RuleRow = { dependsOnValueId: string; priceModifierCents: number };

const control =
  "block h-10 w-full rounded border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900";

/**
 * Conditional pricing rules for one option value: "while <option> is
 * <value>, this value's price adjustment is <amount>" — e.g. Match Tabletop
 * +$750 while Table Top Wood is Walnut. The default price above applies when
 * no rule matches; the first matching rule (top to bottom) wins. Submitted
 * with the value form as JSON in `priceRules`; the server validates it.
 */
export function PriceRulesEditor({ groups, initial, perUnit }: { groups: RuleGroup[]; initial: RuleRow[]; perUnit: boolean }) {
  const groupOfValue = new Map(groups.flatMap((g) => g.values.map((v) => [v.id, g.id] as const)));
  const nextKey = useRef(initial.length);
  const [rows, setRows] = useState(() =>
    initial.map((r, i) => ({ key: i, groupId: groupOfValue.get(r.dependsOnValueId) ?? "", valueId: r.dependsOnValueId, price: centsToDollarInput(r.priceModifierCents) })),
  );
  const { fieldErrors } = useAdminForm();
  const error = fieldErrors.priceRules;

  const update = (key: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) =>
    setRows((rs) => {
      const next = [...rs];
      const [row] = next.splice(i, 1);
      next.splice(i + by, 0, row!);
      return next;
    });

  return (
    <fieldset className="grid gap-3 rounded border border-neutral-200 p-4 sm:col-span-2" aria-describedby="price-rules-help">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Conditional pricing rules</legend>
      <input type="hidden" name="priceRules" value={JSON.stringify(rows.map((r) => ({ dependsOnValueId: r.valueId, price: r.price })))} />
      <p id="price-rules-help" className="text-xs text-neutral-500">
        Optional. Make this value&apos;s {perUnit ? "price per unit" : "price adjustment"} depend on another choice — e.g. “Match Tabletop” costs +$150 when the tabletop wood is Red Oak. Customers see the price that applies to their current choices. When no rule matches, the price above is used; if several match, the first one wins. Product sales never discount these amounts.
      </p>
      {rows.length ? (
        <ol className="grid gap-2">
          {rows.map((r, i) => {
            const group = groups.find((g) => g.id === r.groupId);
            return (
              <li key={r.key} className="grid gap-2 rounded bg-neutral-50 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_auto] sm:items-end">
                <label className="block text-xs font-medium text-neutral-700">
                  Depends on option
                  <select className={`${control} mt-1`} value={r.groupId} onChange={(e) => update(r.key, { groupId: e.target.value, valueId: "" })}>
                    <option value="">Choose an option…</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-neutral-700">
                  Depends on value
                  <select className={`${control} mt-1`} value={r.valueId} disabled={!group} onChange={(e) => update(r.key, { valueId: e.target.value })}>
                    <option value="">{group ? "Choose a value…" : "Choose an option first"}</option>
                    {group?.values.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.displayName}
                        {v.active ? "" : " (inactive)"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-neutral-700">
                  {perUnit ? "Price per unit" : "Price adjustment"}
                  <span className="relative mt-1 block">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-neutral-500">$</span>
                    <input className={`${control} pl-7 tabular-nums`} inputMode="decimal" value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} placeholder="0.00" />
                  </span>
                </label>
                <span className="flex gap-1">
                  <button type="button" className={adminButton.small} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move rule ${i + 1} up`}>
                    ↑
                  </button>
                  <button type="button" className={adminButton.small} disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={`Move rule ${i + 1} down`}>
                    ↓
                  </button>
                  <button type="button" className={adminButton.small} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Delete rule ${i + 1}`}>
                    Delete
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
      <div>
        <button
          type="button"
          className={adminButton.secondary}
          disabled={!groups.length}
          onClick={() => setRows((rs) => [...rs, { key: nextKey.current++, groupId: rs.at(-1)?.groupId ?? "", valueId: "", price: "" }])}
        >
          Add rule
        </button>
        {!groups.length ? <span className="ml-2 text-xs text-neutral-500">Create another option group first.</span> : null}
      </div>
    </fieldset>
  );
}
