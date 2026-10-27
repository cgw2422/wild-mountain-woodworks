"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { centsToDollarInput, formatCents, formatModifier, parseDollarsToCents } from "@/lib/money";
import { addOnFieldKey, applyConditionalPrices, defaultAddOnChoices, defaultSelection, priceConfiguration } from "@/lib/pricing/engine";
import type { ConfigAddOn, ConfigOptionGroup, ConfigOptionValue, ConfigurableProduct, ConfigurationSelection } from "@/lib/pricing/types";
import { configuredProductLines, type DraftLine } from "@/lib/sales/configured-lines";
import { lineTotal } from "@/lib/sales/totals";
import { adminButton } from "@/components/admin/ui";
import { quoteProductConfigAction } from "@/app/admin/(panel)/sales-actions";

export interface ConfiguratorResult {
  selection: ConfigurationSelection;
  quantity: number;
  overrideTotalCents: number | null;
  calculatedTotalCents: number | null;
  /** The quote lines this configuration produces (same function the server uses). */
  lines: DraftLine[];
}

const control =
  "block w-full rounded border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 aria-[invalid=true]:border-red-500";
const money = (c: number) => (c < 0 ? `−${formatCents(-c, { showZeroCents: true })}` : formatCents(c, { showZeroCents: true }));

/**
 * Configure a catalog product for a quote — the admin layout of the product
 * page's configurator. Options, values, prices, conditional prices, add-ons,
 * validation and the sale all come from the shared pricing engine, so the
 * quote gets exactly the price the website would show; the server re-prices
 * the same selection when the quote is saved.
 */
export function ProductConfigurator({
  productId,
  initial,
  replacingLegacy,
  onApply,
  onCancel,
}: {
  productId: string;
  initial?: { selection: ConfigurationSelection | null; quantity: number; overrideTotalCents: number | null };
  /** Configuring an older product line whose add-on/discount lines are separate. */
  replacingLegacy?: boolean;
  onApply: (r: ConfiguratorResult) => void;
  onCancel: () => void;
}) {
  const [product, setProduct] = useState<ConfigurableProduct | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    quoteProductConfigAction(productId)
      .then((p) => live && setProduct(p))
      .catch(() => live && setProduct(null));
    return () => {
      live = false;
    };
  }, [productId]);

  if (product === undefined) return <p className="py-8 text-center text-sm text-neutral-500">Loading the product&apos;s options…</p>;
  if (product === null) return <p className="py-8 text-center text-sm text-red-700">This product couldn&apos;t be loaded. It may have been deleted.</p>;
  return <ConfiguratorBody product={product} initial={initial} replacingLegacy={replacingLegacy} onApply={onApply} onCancel={onCancel} />;
}

function ConfiguratorBody({
  product,
  initial,
  replacingLegacy,
  onApply,
  onCancel,
}: {
  product: ConfigurableProduct;
  initial?: { selection: ConfigurationSelection | null; quantity: number; overrideTotalCents: number | null };
  replacingLegacy?: boolean;
  onApply: (r: ConfiguratorResult) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [selection, setSelection] = useState<ConfigurationSelection>(() => withDefaults(product, initial?.selection ?? null));
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? 1));
  const [overrideOn, setOverrideOn] = useState(initial?.overrideTotalCents != null);
  const [overrideText, setOverrideText] = useState(initial?.overrideTotalCents != null ? centsToDollarInput(initial.overrideTotalCents) : "");
  const [showErrors, setShowErrors] = useState(false);

  const shown = useMemo(() => applyConditionalPrices(product, selection), [product, selection]);
  const pricing = useMemo(() => priceConfiguration(product, selection), [product, selection]);
  const qty = Number(quantity);
  const qtyValid = Number.isInteger(qty) && qty >= 1 && qty <= 999;
  const overrideCents = overrideOn ? parseDollarsToCents(overrideText) : null;
  const overrideInvalid = overrideOn && (overrideCents == null || Number.isNaN(overrideCents) || overrideCents < 0);
  const result = useMemo(
    () => (qtyValid && !overrideInvalid ? configuredProductLines(product, selection, { quantity: qty, overrideTotalCents: overrideOn ? overrideCents : null, configGroup: "preview" }) : null),
    [product, selection, qty, qtyValid, overrideOn, overrideCents, overrideInvalid],
  );
  const errors = showErrors ? pricing.errors : {};

  const update = (fn: (s: ConfigurationSelection) => ConfigurationSelection) => setSelection((s) => fn(s));
  function setOption(groupId: string, valueId: string | null) {
    update((s) => {
      const options = { ...s.options };
      const optionQuantities = { ...s.optionQuantities };
      if (valueId) options[groupId] = valueId;
      else delete options[groupId];
      const value = valueId ? product.optionGroups.find((g) => g.id === groupId)?.values.find((v) => v.id === valueId) : undefined;
      if (value?.quantity) optionQuantities[groupId] = optionQuantities[groupId] ?? value.quantity.default;
      else delete optionQuantities[groupId];
      return { ...s, options, optionQuantities };
    });
  }
  function setAddOnQty(addOn: ConfigAddOn, q: number) {
    update((s) => ({
      ...s,
      addOns: { ...s.addOns, [addOn.id]: q },
      addOnOptions: addOn.optionGroups.length && q > 0 ? { ...s.addOnOptions, [addOn.id]: { ...defaultAddOnChoices(addOn), ...s.addOnOptions?.[addOn.id] } } : s.addOnOptions,
    }));
  }
  function setAddOnChoice(addOnId: string, groupId: string, valueId: string | null) {
    update((s) => {
      const picks = { ...s.addOnOptions?.[addOnId] };
      if (valueId) picks[groupId] = valueId;
      else delete picks[groupId];
      return { ...s, addOnOptions: { ...s.addOnOptions, [addOnId]: picks } };
    });
  }

  function apply() {
    setShowErrors(true);
    if (!result?.ok) return;
    onApply({ selection, quantity: qty, overrideTotalCents: overrideOn ? overrideCents : null, calculatedTotalCents: result.calculatedTotalCents, lines: result.lines });
  }

  const configurableAddOns = shown.addOns.filter((a) => a.optionGroups.length);
  const simpleAddOns = shown.addOns.filter((a) => !a.optionGroups.length);
  const perPiece = result?.ok ? result.lines.reduce((sum, l) => sum + lineTotal(l), 0) / Math.max(1, qty) : null;

  return (
    // Lives inside the quote form: Enter in a field must not save the draft.
    <div
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
    >
      <div className="min-w-0 space-y-5">
        {replacingLegacy ? (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            This line came from an earlier configuration whose add-on and sale lines are separate. After applying, remove any of those lines this configuration now includes, so nothing is charged twice.
          </p>
        ) : null}
        {product.sale ? (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            Sale on now{product.sale.label ? ` — ${product.sale.label}` : ""}: {product.sale.percent != null ? `${product.sale.percent}% off` : "sale price"} the core price. Options and add-ons aren&apos;t discounted.
          </p>
        ) : null}
        {product.optionGroups.length === 0 && product.addOns.length === 0 ? <p className="text-sm text-neutral-500">This product has no options — it&apos;s quoted at its base price.</p> : null}

        {shown.optionGroups.map((g) => (
          <GroupField
            key={g.id}
            idBase={`${id}-${g.id}`}
            group={g}
            selectedId={selection.options[g.id] ?? null}
            onSelect={(v) => setOption(g.id, v)}
            quantity={selection.optionQuantities?.[g.id]}
            onQuantity={(q) => update((s) => ({ ...s, optionQuantities: { ...s.optionQuantities, [g.id]: q } }))}
            customText={selection.customDetails?.[g.id] ?? ""}
            onCustomText={(t) => update((s) => ({ ...s, customDetails: { ...s.customDetails, [g.id]: t } }))}
            error={errors[g.id]}
          />
        ))}

        {configurableAddOns.map((a) => {
          const q = selection.addOns[a.id] ?? 0;
          const min = Math.max(1, a.minQuantity);
          return (
            <fieldset key={a.id} className="rounded-md border border-neutral-200 p-3">
              <legend className="px-1 text-sm font-semibold text-neutral-900">
                {a.name}
                {!a.required ? <span className="ml-1 font-normal text-neutral-500">(optional)</span> : null}
              </legend>
              <label className="block text-xs font-medium text-neutral-600" htmlFor={`${id}-${a.id}-qty`}>
                How many {a.required ? "" : "(0 = not added)"}
              </label>
              <input
                id={`${id}-${a.id}-qty`}
                type="number"
                inputMode="numeric"
                min={a.required ? min : 0}
                max={a.maxQuantity}
                step={a.quantityEnabled ? a.quantityStep : 1}
                value={q}
                onChange={(e) => setAddOnQty(a, Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                aria-invalid={errors[a.id] ? true : undefined}
                className={cn(control, "mt-1 h-10 w-28 tabular-nums")}
              />
              {errors[a.id] ? <p className="mt-1 text-xs text-red-600">{errors[a.id]}</p> : null}
              {q > 0 ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {a.optionGroups.map((g) => (
                    <GroupField
                      key={g.id}
                      idBase={`${id}-${a.id}-${g.id}`}
                      group={g}
                      selectedId={selection.addOnOptions?.[a.id]?.[g.id] ?? null}
                      onSelect={(v) => setAddOnChoice(a.id, g.id, v)}
                      error={errors[addOnFieldKey(a.id, g.id)]}
                      compact
                    />
                  ))}
                </div>
              ) : null}
            </fieldset>
          );
        })}

        {simpleAddOns.length ? (
          <fieldset className="rounded-md border border-neutral-200 p-3">
            <legend className="px-1 text-sm font-semibold text-neutral-900">Add-ons</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {simpleAddOns.map((a) => (
                <label key={a.id} className="block text-xs font-medium text-neutral-600">
                  {a.name} · {formatCents(a.priceCents)} each {a.required ? "(required)" : ""}
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={a.maxQuantity}
                    step={a.quantityEnabled ? a.quantityStep : 1}
                    value={selection.addOns[a.id] ?? 0}
                    onChange={(e) => setAddOnQty(a, Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                    aria-invalid={errors[a.id] ? true : undefined}
                    className={cn(control, "mt-1 h-10 w-28 tabular-nums")}
                  />
                  {errors[a.id] ? <span className="mt-1 block text-red-600">{errors[a.id]}</span> : null}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {errors._form ? <p className="text-sm text-red-600">{errors._form}</p> : null}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Price — same as the website</p>
          <ul className="mt-2 space-y-1 text-sm">
            {pricing.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="min-w-0 text-neutral-700">
                  {l.label}
                  {l.detail ? <span className="text-neutral-500"> — {l.detail}</span> : null}
                  {l.quantity > 1 ? <span className="text-neutral-500"> × {l.quantity}</span> : null}
                </span>
                <span className="shrink-0 tabular-nums">{money(l.amountCents)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex justify-between border-t border-neutral-200 pt-2 text-sm font-semibold">
            <span>Calculated, each</span>
            <span className="tabular-nums">{pricing.totalCents != null && pricing.valid ? money(pricing.totalCents) : "—"}</span>
          </p>
          {product.sale && pricing.savingsCents > 0 ? <p className="text-right text-xs text-neutral-500">includes {money(pricing.savingsCents)} sale savings</p> : null}
        </div>

        <label className="block text-sm font-medium text-neutral-800" htmlFor={`${id}-pieces`}>
          Number of pieces
          <input id={`${id}-pieces`} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, "").slice(0, 3))} aria-invalid={!qtyValid || undefined} className={cn(control, "mt-1 h-10 w-24 tabular-nums")} />
        </label>

        <div className="rounded-md border border-neutral-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
            <input type="checkbox" checked={overrideOn} onChange={(e) => setOverrideOn(e.target.checked)} className="h-4 w-4" />
            Override the price
          </label>
          {overrideOn ? (
            <div className="mt-2">
              <label className="block text-xs text-neutral-600" htmlFor={`${id}-override`}>
                Quoted price each (replaces the calculated price, incl. its add-ons)
              </label>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-neutral-500">$</span>
                <input id={`${id}-override`} inputMode="decimal" value={overrideText} onChange={(e) => setOverrideText(e.target.value)} aria-invalid={overrideInvalid || undefined} className={cn(control, "h-10 pl-7 tabular-nums")} />
              </div>
              <p className="mt-1 text-xs text-neutral-500">The calculated price is kept for reference (admin only).</p>
            </div>
          ) : null}
        </div>

        <div className="rounded-md bg-neutral-900 p-3 text-white">
          <p className="flex justify-between text-sm">
            <span>Quoted, each</span>
            <span className="tabular-nums">{perPiece != null ? money(perPiece) : "—"}</span>
          </p>
          <p className="mt-1 flex justify-between text-base font-semibold">
            <span>Line total{qtyValid && qty > 1 ? ` (× ${qty})` : ""}</span>
            <span className="tabular-nums">{result?.ok ? money(result.lines.reduce((s, l) => s + lineTotal(l), 0)) : "—"}</span>
          </p>
        </div>
        {showErrors && result && !result.ok ? (
          <p role="alert" className="text-sm text-red-600">
            {result.message}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={adminButton.secondary} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={adminButton.primary} onClick={apply} disabled={!qtyValid || overrideInvalid}>
            Apply to quote
          </button>
        </div>
      </aside>
    </div>
  );
}

/** The saved selection, or the product page's defaults; values that no longer exist are dropped by the engine (shown as errors). */
function withDefaults(product: ConfigurableProduct, saved: ConfigurationSelection | null): ConfigurationSelection {
  const d = defaultSelection(product);
  if (!saved) return d;
  return { options: { ...saved.options }, optionQuantities: { ...saved.optionQuantities }, addOns: { ...saved.addOns }, addOnOptions: { ...saved.addOnOptions }, customDetails: { ...saved.customDetails } };
}

function priceLabel(group: ConfigOptionGroup, v: ConfigOptionValue) {
  if (group.setsUnitPrice || v.quantity) return `${formatCents(v.priceModifierCents)} each`;
  return formatModifier(v.priceModifierCents);
}

function GroupField({
  idBase,
  group,
  selectedId,
  onSelect,
  quantity,
  onQuantity,
  customText,
  onCustomText,
  error,
  compact,
}: {
  idBase: string;
  group: ConfigOptionGroup;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  quantity?: number;
  onQuantity?: (q: number) => void;
  customText?: string;
  onCustomText?: (t: string) => void;
  error?: string;
  compact?: boolean;
}) {
  const selected = group.values.find((v) => v.id === selectedId);
  return (
    <div>
      <label htmlFor={`${idBase}-sel`} className={cn("block font-medium text-neutral-800", compact ? "text-xs" : "text-sm")}>
        {group.displayName}
        {!group.required ? <span className="ml-1 font-normal text-neutral-500">(optional)</span> : null}
      </label>
      <select
        id={`${idBase}-sel`}
        value={selectedId ?? ""}
        onChange={(e) => onSelect(e.target.value || null)}
        aria-invalid={error ? true : undefined}
        className={cn(control, "mt-1 h-10")}
      >
        {!group.required || !selectedId ? <option value="">{group.required ? "Choose…" : "None"}</option> : null}
        {group.values.map((v) => (
          <option key={v.id} value={v.id}>
            {v.displayName}
            {priceLabel(group, v) ? ` (${priceLabel(group, v)})` : ""}
          </option>
        ))}
      </select>
      {selected?.quantity && onQuantity ? (
        <label className="mt-2 block text-xs text-neutral-600">
          How many ({selected.quantity.min}–{selected.quantity.max}
          {selected.quantity.step > 1 ? `, steps of ${selected.quantity.step}` : ""})
          <input
            type="number"
            inputMode="numeric"
            min={selected.quantity.min}
            max={selected.quantity.max}
            step={selected.quantity.step}
            value={quantity ?? selected.quantity.default}
            onChange={(e) => onQuantity(Math.trunc(Number(e.target.value) || 0))}
            className={cn(control, "mt-1 h-10 w-24 tabular-nums")}
          />
        </label>
      ) : null}
      {selected?.isCustom && onCustomText ? (
        <label className="mt-2 block text-xs text-neutral-600">
          Describe the custom {group.displayName.toLowerCase()}
          <textarea value={customText ?? ""} maxLength={2000} rows={2} onChange={(e) => onCustomText(e.target.value)} className={cn(control, "mt-1 py-2")} />
        </label>
      ) : null}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
