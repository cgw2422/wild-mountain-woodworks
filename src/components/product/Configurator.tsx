"use client";


import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { formatCents, formatModifier } from "@/lib/money";
import { chosenQuantity, defaultSelection, priceConfiguration } from "@/lib/pricing/engine";
import type { ConfigAddOn, ConfigOptionGroup, ConfigOptionValue, ConfigurableProduct, ConfigurationSelection, OptionQuantitySpec } from "@/lib/pricing/types";
import { TIMELINE_OPTIONS, clientRules } from "@/lib/validation/shared";
import { submitConfigurationQuote } from "@/app/(site)/actions";
import { clientValidator, usePublicForm } from "@/components/forms/usePublicForm";

const validateRequest = clientValidator(clientRules.configurationQuote);
import {
  AntiSpamFields,
  FormErrorSummary,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
} from "@/components/forms/fields";

export type PurchaseMode = "quote" | "contact";

export interface ConfiguratorProps {
  product: ConfigurableProduct;
  pricesVisible: boolean;
  priceDisclaimer: string | null;
  /**
   * quote   → "Request This Configuration" (launch)
   * contact → quotes disabled; send customers to the contact page
   */
  mode: PurchaseMode;
  requestCopy: { heading: string | null; body: React.ReactNode };
  confirmationCopy: { heading: string | null; body: React.ReactNode };
  /** Which linked CMS pages are published (unpublished ones aren't linked). */
  publicLinks: { contact: boolean; privacy: boolean };
  /** Quiet payment-options block shown under the request button (Settings → Payments). */
  paymentNote?: React.ReactNode;
}

export function Configurator({ product, pricesVisible, priceDisclaimer, mode, requestCopy, confirmationCopy, publicLinks, paymentNote }: ConfiguratorProps) {
  const [selection, setSelection] = useState<ConfigurationSelection>(() => defaultSelection(product));
  const [showErrors, setShowErrors] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const ctaRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [ctaVisible, setCtaVisible] = useState(true);

  const pricing = useMemo(() => priceConfiguration(product, selection), [product, selection]);
  const errors = showErrors ? { ...pricing.errors, ...serverErrors } : serverErrors;

  useEffect(() => {
    const el = ctaRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setCtaVisible(Boolean(e?.isIntersecting)), { rootMargin: "0px 0px -40px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const update = useCallback((fn: (s: ConfigurationSelection) => ConfigurationSelection) => {
    setServerErrors({});
    setSelection((s) => fn(s));
  }, []);

  function setOption(groupId: string, valueId: string | null) {
    update((s) => {
      const options = { ...s.options };
      const optionQuantities = { ...s.optionQuantities };
      if (valueId) options[groupId] = valueId;
      else delete options[groupId];
      // Switching style keeps the chosen quantity when it still fits; otherwise the new value's default.
      const value = valueId ? product.optionGroups.find((g) => g.id === groupId)?.values.find((v) => v.id === valueId) : undefined;
      if (value?.quantity) {
        const current = optionQuantities[groupId];
        const fits = current !== undefined && current >= value.quantity.min && current <= value.quantity.max && (current - value.quantity.min) % value.quantity.step === 0;
        optionQuantities[groupId] = fits ? current : value.quantity.default;
      } else delete optionQuantities[groupId];
      return { ...s, options, optionQuantities };
    });
  }

  function setOptionQuantity(groupId: string, qty: number) {
    update((s) => ({ ...s, optionQuantities: { ...s.optionQuantities, [groupId]: qty } }));
  }

  function setAddOn(addOnId: string, qty: number) {
    update((s) => ({ ...s, addOns: { ...s.addOns, [addOnId]: qty } }));
  }

  function setCustom(groupId: string, text: string) {
    update((s) => ({ ...s, customDetails: { ...s.customDetails, [groupId]: text } }));
  }

  function requestConfiguration() {
    if (!pricing.valid) {
      setShowErrors(true);
      requestAnimationFrame(() => {
        const first = Object.keys(pricing.errors)[0];
        const el = first ? document.getElementById(`cfg-${first}`) : null;
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        el?.querySelector<HTMLElement>("input, select, textarea, button")?.focus({ preventScroll: true });
      });
      return;
    }
    setPanelOpen(true);
    requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      panelRef.current?.querySelector<HTMLElement>("input:not([type=hidden])")?.focus({ preventScroll: true });
    });
  }

  const total = pricing.totalCents;
  const showTotal = pricesVisible && total != null;
  const regularTotal = showTotal && pricing.savingsCents > 0 ? total! + pricing.savingsCents : null;
  const ctaLabel = "Request This Configuration";

  return (
    <div className="space-y-10">
      {product.optionGroups.map((group) => (
        <OptionGroupField
          key={group.id}
          group={group}
          selectedId={selection.options[group.id] ?? null}
          customText={selection.customDetails?.[group.id] ?? ""}
          quantity={selection.optionQuantities?.[group.id]}
          onQuantity={(q) => setOptionQuantity(group.id, q)}
          onSelect={(v) => setOption(group.id, v)}
          onCustomText={(t) => setCustom(group.id, t)}
          error={errors[group.id]}
          pricesVisible={pricesVisible}
        />
      ))}

      {product.addOns.length ? (
        <fieldset id="cfg-addons" className="space-y-3">
          <legend className="mb-4 text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-charcoal">Add-ons</legend>
          {product.addOns.map((a) => (
            <AddOnField
              key={a.id}
              addOn={a}
              quantity={selection.addOns[a.id] ?? 0}
              onChange={(q) => setAddOn(a.id, q)}
              error={errors[a.id]}
              pricesVisible={pricesVisible}
            />
          ))}
        </fieldset>
      ) : null}

      {/* Summary + CTA */}
      <div ref={ctaRef} className="border-t border-stone pt-8">
        {showTotal ? (
          <div className="mb-6">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-[0.78rem] font-semibold uppercase tracking-[0.14em]">Estimated total</span>
              <span className="nums font-display text-[2.2rem] leading-none" aria-live="polite">
                {regularTotal != null ? (
                  <>
                    <del className="mr-3 align-middle text-[1.3rem] text-muted decoration-1">
                      <span className="sr-only">Regular price </span>
                      {formatCents(regularTotal)}
                    </del>
                    <span className="sr-only">Sale price </span>
                  </>
                ) : null}
                {formatCents(total!)}
              </span>
            </div>
            {regularTotal != null ? (
              <p className="mt-2 text-right text-sm font-semibold text-bronze-text">
                On sale — you save <span className="nums">{formatCents(pricing.savingsCents)}</span>
              </p>
            ) : null}
            <details className="group mt-4">
              <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-2 py-1 text-sm text-muted hover:text-charcoal [&::-webkit-details-marker]:hidden">
                <span className="link-quiet">Price breakdown</span>
                <span aria-hidden="true" className="transition-transform group-open:rotate-180">
                  ⌄
                </span>
              </summary>
              <dl className="mt-3 space-y-1.5 text-sm">
                {pricing.lines.map((l, i) => (
                  <div key={i} className="flex justify-between gap-4">
                    <dt className="text-muted">
                      {l.kind === "base" ? (pricing.savingsCents > 0 ? "Base price (sale)" : "Base price") : l.kind === "option" ? `${l.label}: ${l.detail}${l.quantity !== 1 ? ` × ${l.quantity}` : ""}` : `${l.label}${l.quantity > 1 ? ` × ${l.quantity}` : ""}`}
                    </dt>
                    <dd className="nums">{l.kind === "base" ? formatCents(l.amountCents) : l.amountCents === 0 ? "Included" : formatModifier(l.amountCents)}</dd>
                  </div>
                ))}
              </dl>
            </details>
            {pricing.requiresCustomQuote ? (
              <p className="mt-4 border-l border-bronze pl-3 text-sm text-muted">Custom selections are priced individually and confirmed with your quote.</p>
            ) : null}
            {priceDisclaimer ? <p className="mt-3 text-xs text-muted">{priceDisclaimer}</p> : null}
          </div>
        ) : (
          <p className="mb-6 text-sm text-muted">Pricing for your configuration is provided with your personal quote.</p>
        )}

        {mode === "contact" ? (
          publicLinks.contact ? (
            <Link
              href={`/contact`}
              className="flex min-h-14 w-full items-center justify-center bg-charcoal px-8 text-[0.74rem] font-semibold uppercase tracking-[0.16em] text-ivory transition-colors hover:bg-walnut"
            >
              Contact Us About This Piece
            </Link>
          ) : (
            <p className="text-sm text-muted">Online quote requests are paused. Please get in touch with us directly about this piece.</p>
          )
        ) : (
          <button
            type="button"
            onClick={requestConfiguration}
            aria-expanded={panelOpen}
            aria-controls="request-panel"
            className="flex min-h-14 w-full items-center justify-center bg-charcoal px-8 text-[0.74rem] font-semibold uppercase tracking-[0.16em] text-ivory transition-colors hover:bg-walnut"
          >
            {ctaLabel}
          </button>
        )}
        {showErrors && !pricing.valid ? (
          <p role="alert" className="mt-3 text-sm text-error">
            {pricing.errors._form ?? "Please complete the highlighted choices above."}
          </p>
        ) : null}
        {paymentNote ? <div className="mt-5">{paymentNote}</div> : null}
      </div>

      {panelOpen && mode === "quote" ? (
        <div ref={panelRef} id="request-panel" className="scroll-mt-28">
          <RequestPanel
            product={product}
            selection={selection}
            pricing={pricing}
            showTotal={showTotal}
            copy={requestCopy}
            confirmation={confirmationCopy}
            privacyLink={publicLinks.privacy}
            onServerErrors={(e) => {
              setServerErrors(e);
              setShowErrors(true);
            }}
          />
        </div>
      ) : null}

      {/* Mobile sticky CTA */}
      {mode !== "contact" && !panelOpen ? (
        <div
          className={cn(
            "fixed inset-x-0 bottom-0 z-30 border-t border-stone bg-ivory/97 px-5 py-3 backdrop-blur-sm transition-transform duration-300 lg:hidden",
            ctaVisible ? "translate-y-full" : "translate-y-0",
          )}
          aria-hidden={ctaVisible}
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate font-display text-lg leading-tight">{product.name}</p>
              {showTotal ? (
                <p className="text-sm nums text-muted">
                  Est. {regularTotal != null ? <del className="mr-1 decoration-1">{formatCents(regularTotal)}</del> : null}
                  {formatCents(total!)}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              tabIndex={ctaVisible ? -1 : 0}
              onClick={requestConfiguration}
              className="min-h-12 shrink-0 bg-charcoal px-5 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-ivory"
            >
              Request
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function GroupLegend({ group, selectedLabel, error }: { group: ConfigOptionGroup; selectedLabel?: string; error?: string }) {
  return (
    <legend className="mb-4 flex w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <span className="text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-charcoal">
        {group.displayName}
        {!group.required ? <span className="ml-2 font-normal normal-case tracking-normal text-muted">(optional)</span> : null}
      </span>
      {selectedLabel ? <span className="text-sm text-muted">{selectedLabel}</span> : null}
      {error ? <span className="sr-only">{error}</span> : null}
    </legend>
  );
}

function OptionGroupField({
  group,
  selectedId,
  customText,
  quantity,
  onQuantity,
  onSelect,
  onCustomText,
  error,
  pricesVisible,
}: {
  group: ConfigOptionGroup;
  selectedId: string | null;
  customText: string;
  /** Chosen quantity for a quantity-based value (undefined → the value's default). */
  quantity: number | undefined;
  onQuantity: (q: number) => void;
  onSelect: (id: string | null) => void;
  onCustomText: (t: string) => void;
  error?: string;
  pricesVisible: boolean;
}) {
  const name = useId();
  const selected = group.values.find((v) => v.id === selectedId);
  const modOnly = (cents: number) => (pricesVisible && cents !== 0 ? formatModifier(cents) : "");
  // Quantity-based values are priced per unit ("$192.50 each"); others as a modifier ("+$350").
  const priceOf = (v: ConfigOptionValue) => (v.quantity ? (pricesVisible && v.priceModifierCents ? `${formatCents(v.priceModifierCents)} each` : "") : modOnly(v.priceModifierCents));
  const qty = selected?.quantity ? (quantity ?? selected.quantity.default) : null;
  const errorId = `${name}-err`;

  const radio = (valueId: string | null) => ({
    type: "radio" as const,
    name,
    checked: selectedId === valueId,
    onChange: () => onSelect(valueId),
    className: "peer sr-only",
    "aria-describedby": error ? errorId : undefined,
  });

  let control: React.ReactNode;
  switch (group.inputType) {
    case "DROPDOWN": {
      control = (
        <div className="relative">
          <label htmlFor={`${name}-select`} className="sr-only">
            {group.displayName}
          </label>
          <select
            id={`${name}-select`}
            value={selectedId ?? ""}
            onChange={(e) => onSelect(e.target.value || null)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="h-12 w-full appearance-none border border-stone-dark/70 bg-paper px-4 pr-10 text-[0.98rem] focus:border-charcoal focus:outline-none"
          >
            {!group.required || !selectedId ? <option value="">{group.required ? "Select…" : "No preference"}</option> : null}
            {group.values.map((v) => (
              <option key={v.id} value={v.id}>
                {v.displayName}
                {priceOf(v) ? ` (${priceOf(v)})` : ""}
              </option>
            ))}
          </select>
          <svg viewBox="0 0 12 8" className="pointer-events-none absolute right-4 top-1/2 h-2 w-3 -translate-y-1/2" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
            <path d="M1 1.5l5 5 5-5" />
          </svg>
        </div>
      );
      break;
    }
    case "SWATCH": {
      control = (
        <div className="flex flex-wrap gap-x-5 gap-y-4">
          {group.values.map((v) => (
            <label key={v.id} className="group flex w-[4.5rem] cursor-pointer flex-col items-center gap-2 text-center">
              <input {...radio(v.id)} />
              <span
                className="relative h-12 w-12 overflow-hidden rounded-full ring-1 ring-stone-dark/50 ring-offset-2 ring-offset-ivory transition peer-checked:ring-2 peer-checked:ring-charcoal peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-bronze-text"
                style={{ background: v.swatchColor ?? "#d8cdbb" }}
                aria-hidden="true"
              >
                {v.image ? <Image src={v.image.url} alt="" fill sizes="48px" className="object-cover" /> : null}
              </span>
              <span className="text-xs leading-tight text-charcoal">{v.displayName}</span>
              {priceOf(v) ? <span className="-mt-1.5 text-[0.7rem] text-muted">{priceOf(v)}</span> : null}
            </label>
          ))}
        </div>
      );
      break;
    }
    case "IMAGE": {
      control = (
        <div className={cn("grid gap-3", group.values.length > 4 ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-4")}>
          {group.values.map((v) => (
            <label key={v.id} className="cursor-pointer">
              <input {...radio(v.id)} />
              <span className="block border border-stone bg-paper p-1.5 transition peer-checked:border-charcoal peer-checked:shadow-[inset_0_0_0_1px_var(--color-charcoal)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-bronze-text hover:border-stone-dark">
                <span className="relative block aspect-square overflow-hidden bg-stone-light" style={v.swatchColor ? { background: v.swatchColor } : undefined}>
                  {v.image ? (
                    <Image
                      src={v.image.url}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 120px, 25vw"
                      className="object-cover"
                      style={{ objectPosition: `${v.image.focalX ?? 50}% ${v.image.focalY ?? 50}%` }}
                    />
                  ) : null}
                </span>
                <span className="mt-2 block px-0.5 text-[0.82rem] font-medium leading-tight">{v.displayName}</span>
                <span className="block px-0.5 pb-0.5 text-[0.72rem] text-muted">{priceOf(v) || (v.isCustom ? "Quoted" : " ")}</span>
              </span>
            </label>
          ))}
        </div>
      );
      break;
    }
    case "RADIO": {
      control = (
        <div className="divide-y divide-stone border-y border-stone">
          {!group.required ? (
            <label className="flex cursor-pointer items-center gap-4 py-3.5">
              <input {...radio(null)} />
              <RadioDot />
              <span className="flex-1 text-[0.95rem]">No preference</span>
            </label>
          ) : null}
          {group.values.map((v) => (
            <label key={v.id} className="flex cursor-pointer items-center gap-4 py-3.5">
              <input {...radio(v.id)} />
              <RadioDot />
              <span className="flex-1">
                <span className="block text-[0.95rem]">{v.displayName}</span>
                {v.description ? <span className="block text-sm text-muted">{v.description}</span> : null}
              </span>
              <span className="text-sm nums text-muted">{priceOf(v)}</span>
            </label>
          ))}
        </div>
      );
      break;
    }
    default: {
      // BUTTONS
      control = (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {group.values.map((v) => (
            <label key={v.id} className="cursor-pointer">
              <input {...radio(v.id)} />
              <span className="flex min-h-[3.75rem] flex-col justify-center border border-stone bg-paper px-3.5 py-2.5 transition hover:border-stone-dark peer-checked:border-charcoal peer-checked:bg-charcoal peer-checked:text-ivory peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-bronze-text">
                <span className="text-[0.92rem] font-medium leading-tight">{v.displayName}</span>
                {v.description || priceOf(v) ? (
                  <span className="mt-0.5 text-[0.72rem] leading-snug opacity-75">
                    {[v.description, priceOf(v)].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
          {!group.required ? (
            <label className="cursor-pointer">
              <input {...radio(null)} />
              <span className="flex min-h-[3.75rem] items-center border border-stone bg-paper px-3.5 text-[0.92rem] transition hover:border-stone-dark peer-checked:border-charcoal peer-checked:bg-charcoal peer-checked:text-ivory">
                No preference
              </span>
            </label>
          ) : null}
        </div>
      );
    }
  }

  return (
    <fieldset id={`cfg-${group.id}`} className="scroll-mt-32" aria-invalid={error ? true : undefined}>
      <GroupLegend
        group={group}
        error={error}
        selectedLabel={
          selected
            ? selected.quantity
              ? `${selected.displayName} × ${qty}`
              : `${selected.displayName}${modOnly(selected.priceModifierCents) ? ` · ${modOnly(selected.priceModifierCents)}` : ""}`
            : undefined
        }
      />
      {group.description ? <p className="-mt-2 mb-4 text-sm text-muted">{group.description}</p> : null}
      {control}
      {selected?.quantity && qty != null ? (
        <QuantityStepper
          id={`${name}-qty`}
          label={`How many — ${selected.displayName}`}
          spec={selected.quantity}
          value={qty}
          onChange={onQuantity}
          unitCents={pricesVisible ? selected.priceModifierCents : null}
          invalid={Boolean(error)}
          describedBy={error ? errorId : undefined}
        />
      ) : null}
      {selected?.isCustom ? (
        <div className="mt-4">
          <label htmlFor={`${name}-custom`} className="mb-2 block text-sm font-medium">
            Describe your custom {group.displayName.toLowerCase()}
          </label>
          <textarea
            id={`${name}-custom`}
            rows={3}
            maxLength={500}
            value={customText}
            onChange={(e) => onCustomText(e.target.value)}
            placeholder={group.displayName.toLowerCase().includes("size") || group.displayName.toLowerCase().includes("length") ? "e.g. 78 × 40 in to fit our dining room" : "Tell us what you have in mind"}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="block w-full border border-stone-dark/70 bg-paper px-4 py-3 text-[0.98rem] focus:border-charcoal focus:outline-none aria-[invalid=true]:border-error"
          />
        </div>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-2 text-sm font-medium text-error">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * Quantity for a quantity-based value: − / + buttons plus a typed number,
 * within the value's min/max/step (zero allowed when the minimum is 0, e.g.
 * the table without chairs). The server re-checks every quantity.
 */
function QuantityStepper({
  id,
  label,
  spec,
  value,
  onChange,
  unitCents,
  invalid,
  describedBy,
}: {
  id: string;
  label: string;
  spec: OptionQuantitySpec;
  value: number;
  onChange: (q: number) => void;
  unitCents: number | null;
  invalid: boolean;
  describedBy?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (q: number) => Math.min(spec.max, Math.max(spec.min, q));
  const commit = (raw: string) => {
    setDraft(null);
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) return;
    // Snap onto the step grid (from the minimum) so the result is always valid.
    const c = clamp(n);
    onChange(spec.min + Math.floor((c - spec.min) / spec.step) * spec.step);
  };
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border border-stone bg-paper px-4 py-3">
      <label htmlFor={id} className="text-sm">
        <span className="block font-medium text-charcoal">Quantity</span>
        <span className="block text-xs text-muted">{spec.min === 0 ? `Choose 0 for none · up to ${spec.max}` : `${spec.min}–${spec.max}`}{spec.step > 1 ? ` · in steps of ${spec.step}` : ""}</span>
      </label>
      <div className="flex items-center gap-4">
        <div className="flex items-center" role="group" aria-label={label}>
          <button
            type="button"
            onClick={() => onChange(clamp(value - spec.step))}
            disabled={value - spec.step < spec.min}
            className="flex h-11 w-11 items-center justify-center border border-stone text-lg disabled:opacity-40"
            aria-label="Decrease quantity"
          >
            −
          </button>
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={draft ?? String(value)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit((e.target as HTMLInputElement).value);
              }
            }}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
            className="h-11 w-16 border-y border-stone bg-paper text-center nums [appearance:textfield] focus:border-charcoal focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            type="button"
            onClick={() => onChange(clamp(value + spec.step))}
            disabled={value + spec.step > spec.max}
            className="flex h-11 w-11 items-center justify-center border border-stone text-lg disabled:opacity-40"
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
        {unitCents != null && unitCents > 0 ? (
          <span className="min-w-[5.5rem] text-right text-sm nums text-muted" aria-live="polite">
            {value === 0 ? "None" : formatModifier(unitCents * value)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RadioDot() {
  return (
    <span
      aria-hidden="true"
      className="relative h-[1.1rem] w-[1.1rem] shrink-0 rounded-full border border-stone-dark transition peer-checked:border-charcoal peer-checked:[&>span]:scale-100 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-bronze-text"
    >
      <span className="absolute inset-[3px] scale-0 rounded-full bg-charcoal transition-transform" />
    </span>
  );
}

function AddOnField({
  addOn,
  quantity,
  onChange,
  error,
  pricesVisible,
}: {
  addOn: ConfigAddOn;
  quantity: number;
  onChange: (q: number) => void;
  error?: string;
  pricesVisible: boolean;
}) {
  const id = useId();
  const checked = quantity > 0;
  const min = addOn.required ? Math.max(1, addOn.minQuantity) : addOn.minQuantity;
  const price = pricesVisible ? (addOn.priceCents ? `+${formatCents(addOn.priceCents)}${addOn.maxQuantity > 1 ? " each" : ""}` : "Included") : "";
  return (
    <div id={`cfg-${addOn.id}`} className={cn("border bg-paper transition", checked ? "border-charcoal" : "border-stone")}>
      <div className="flex items-center gap-4 p-4">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={addOn.required}
          onChange={(e) => onChange(e.target.checked ? Math.max(1, min) : 0)}
          className="h-5 w-5 shrink-0 accent-[var(--color-charcoal)]"
          aria-describedby={addOn.description ? `${id}-d` : undefined}
        />
        {addOn.image ? (
          <span className="relative hidden h-14 w-14 shrink-0 overflow-hidden bg-stone-light sm:block">
            <Image src={addOn.image.url} alt="" fill sizes="56px" className="object-cover" />
          </span>
        ) : null}
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[0.95rem] font-medium">
              {addOn.name}
              {addOn.required ? <span className="ml-2 text-xs font-normal text-muted">Required</span> : null}
            </span>
            <span className="shrink-0 text-sm nums text-muted">{price}</span>
          </span>
          {addOn.description ? (
            <span id={`${id}-d`} className="mt-0.5 block text-sm leading-snug text-muted">
              {addOn.description}
            </span>
          ) : null}
        </label>
      </div>
      {checked && addOn.maxQuantity > 1 ? (
        <div className="flex items-center justify-between border-t border-stone px-4 py-2.5">
          <span id={`${id}-qty`} className="text-sm text-muted">
            Quantity
          </span>
          <div className="flex items-center" role="group" aria-labelledby={`${id}-qty`}>
            <button
              type="button"
              onClick={() => onChange(Math.max(Math.max(1, min), quantity - 1))}
              disabled={quantity <= Math.max(1, min)}
              className="flex h-10 w-10 items-center justify-center border border-stone disabled:opacity-40"
              aria-label={`Decrease ${addOn.name} quantity`}
            >
              −
            </button>
            <span className="w-10 text-center nums" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => onChange(Math.min(addOn.maxQuantity, quantity + 1))}
              disabled={quantity >= addOn.maxQuantity}
              className="flex h-10 w-10 items-center justify-center border border-stone disabled:opacity-40"
              aria-label={`Increase ${addOn.name} quantity`}
            >
              +
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="px-4 pb-3 text-sm font-medium text-error">{error}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function RequestPanel({
  product,
  selection,
  pricing,
  showTotal,
  copy,
  confirmation,
  privacyLink,
  onServerErrors,
}: {
  product: ConfigurableProduct;
  selection: ConfigurationSelection;
  pricing: ReturnType<typeof priceConfiguration>;
  showTotal: boolean;
  copy: { heading: string | null; body: React.ReactNode };
  confirmation: { heading: string | null; body: React.ReactNode };
  privacyLink: boolean;
  onServerErrors: (e: Record<string, string>) => void;
}) {
  // A product quote is the structured configuration plus notes — no file
  // uploads (inspiration photos belong to custom furniture requests).
  const opts = useMemo(
    () => ({
      prepare: (fd: FormData) => {
        fd.set("productId", product.id);
        fd.set("selection", JSON.stringify(selection));
      },
      validate: validateRequest,
    }),
    [product.id, selection],
  );
  const { state, pending, onSubmit, formRef, fieldErrors } = usePublicForm(submitConfigurationQuote, opts);
  const successRef = useRef<HTMLDivElement>(null);

  // Configuration problems found by the server are shown on the configurator.
  useEffect(() => {
    if (state.status !== "error" || !state.fieldErrors) return;
    const cfgErrors = Object.fromEntries(
      Object.entries(state.fieldErrors).filter(([k]) => product.optionGroups.some((g) => g.id === k) || product.addOns.some((a) => a.id === k)),
    );
    if (Object.keys(cfgErrors).length) onServerErrors(cfgErrors);
  }, [state, product, onServerErrors]);

  useEffect(() => {
    if (state.status === "success") successRef.current?.focus();
  }, [state.status]);

  const summary = (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
      {product.optionGroups.map((g) => {
        const v = g.values.find((x) => x.id === selection.options[g.id]);
        if (!v) return null;
        const q = v.quantity ? chosenQuantity(v, selection, g.id) : null;
        return (
          <div key={g.id} className="contents">
            <dt className="text-muted">{g.displayName}</dt>
            <dd>
              {q === 0 ? "None" : v.displayName}
              {q != null && q > 0 ? ` × ${q}` : ""}
              {v.isCustom && selection.customDetails?.[g.id] ? ` — ${selection.customDetails[g.id]}` : ""}
            </dd>
          </div>
        );
      })}
      {product.addOns
        .filter((a) => (selection.addOns[a.id] ?? 0) > 0)
        .map((a) => (
          <div key={a.id} className="contents">
            <dt className="text-muted">Add-on</dt>
            <dd>
              {a.name}
              {(selection.addOns[a.id] ?? 0) > 1 ? ` × ${selection.addOns[a.id]}` : ""}
            </dd>
          </div>
        ))}
      {showTotal && pricing.totalCents != null ? (
        <div className="contents">
          <dt className="text-muted">Estimate</dt>
          <dd className="nums">{formatCents(pricing.totalCents)}</dd>
        </div>
      ) : null}
    </dl>
  );

  if (state.status === "success") {
    return (
      <div ref={successRef} tabIndex={-1} role="status" className="border border-charcoal bg-paper p-6 focus:outline-none sm:p-8">
        <p className="eyebrow text-bronze-text">Request received</p>
        <h3 className="display-sm mt-3">{confirmation.heading || "Thank you — your request is in."}</h3>
        {confirmation.body || <p className="mt-3 leading-relaxed text-muted">We&apos;ve received your request and will be in touch soon.</p>}
        {state.reference ? (
          <p className="mt-5 text-sm">
            Your reference number: <strong className="font-semibold tracking-wide">{state.reference}</strong>
          </p>
        ) : null}
        <div className="mt-6 border-t border-stone pt-5">
          <p className="mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.14em]">{product.name}</p>
          {summary}
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="relative border border-stone bg-paper p-6 sm:p-8" aria-labelledby="request-heading">
      <h3 id="request-heading" className="display-sm">
        {copy.heading || "Request this configuration"}
      </h3>
      {copy.body}

      <div className="mt-6 bg-ivory p-5">
        <p className="mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.14em]">Your configuration · {product.name}</p>
        {summary}
      </div>

      <div className="mt-8 space-y-5">
        <FormErrorSummary message={state.status === "error" ? state.message : undefined} />
        <AntiSpamFields />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label="Name" name="name" autoComplete="name" required error={fieldErrors.name} maxLength={120} />
          <TextField label="Email" name="email" type="email" autoComplete="email" required error={fieldErrors.email} maxLength={254} />
          <TextField label="Phone" name="phone" type="tel" autoComplete="tel" error={fieldErrors.phone} maxLength={30} />
          <TextField label="ZIP code" name="zipCode" inputMode="numeric" autoComplete="postal-code" required error={fieldErrors.zipCode} maxLength={10} hint="For delivery planning." />
          <TextField label="Quantity" name="quantity" type="number" inputMode="numeric" min={1} max={20} defaultValue={1} required error={fieldErrors.quantity} hint="How many of this piece." />
        </div>
        <TextField label="Delivery address" name="address" autoComplete="street-address" error={fieldErrors.address} maxLength={300} hint="Helps us quote delivery accurately." />
        <SelectField label="Desired timeline" name="timeline" options={TIMELINE_OPTIONS.map((t) => ({ value: t, label: t }))} error={fieldErrors.timeline} />
        <TextAreaField label="Notes" name="notes" rows={4} maxLength={4000} error={fieldErrors.notes} placeholder="Anything else we should know — room size, questions, special requests." />
        <SubmitButton pending={pending} className="w-full" pendingLabel="Sending request…">
          Request Quote
        </SubmitButton>
        <p className="text-xs text-muted">
          No payment is required now. We&apos;ll review your request and send a personal quote you can accept online. We&apos;ll use your details only to respond to this request
          {privacyLink ? (
            <>
              {" "}
              — see our{" "}
              <Link href="/privacy" className="link-quiet">
                privacy policy
              </Link>
            </>
          ) : null}
          .
        </p>
      </div>
    </form>
  );
}
