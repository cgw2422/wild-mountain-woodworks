"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { formatCents, formatModifier } from "@/lib/money";
import { defaultSelection, priceConfiguration } from "@/lib/pricing/engine";
import type { ConfigAddOn, ConfigOptionGroup, ConfigurableProduct, ConfigurationSelection } from "@/lib/pricing/types";
import { TIMELINE_OPTIONS, clientRules } from "@/lib/validation/shared";
import { submitConfigurationQuote } from "@/app/(site)/actions";
import { clientValidator, usePublicForm } from "@/components/forms/usePublicForm";

const validateRequest = clientValidator(clientRules.configurationQuote);
import {
  AntiSpamFields,
  FormErrorSummary,
  ReferenceImagesField,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
} from "@/components/forms/fields";

export type PurchaseMode = "quote" | "cart" | "contact";

export interface ConfiguratorProps {
  product: ConfigurableProduct;
  pricesVisible: boolean;
  priceDisclaimer: string | null;
  /**
   * quote   → "Request This Configuration" (launch)
   * cart    → "Add to Cart" (future; only when e-commerce is fully enabled)
   * contact → quotes disabled; send customers to the contact page
   */
  mode: PurchaseMode;
  requestCopy: { heading: string | null; body: string | null };
  confirmationCopy: { heading: string | null; body: string | null };
}

export function Configurator({ product, pricesVisible, priceDisclaimer, mode, requestCopy, confirmationCopy }: ConfiguratorProps) {
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
      if (valueId) options[groupId] = valueId;
      else delete options[groupId];
      return { ...s, options };
    });
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
  const ctaLabel = mode === "cart" ? "Add to Cart" : "Request This Configuration";

  return (
    <div className="space-y-10">
      {product.optionGroups.map((group) => (
        <OptionGroupField
          key={group.id}
          group={group}
          selectedId={selection.options[group.id] ?? null}
          customText={selection.customDetails?.[group.id] ?? ""}
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
                {formatCents(total!)}
              </span>
            </div>
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
                      {l.kind === "base" ? "Base price" : l.kind === "option" ? `${l.label}: ${l.detail}` : `${l.label}${l.quantity > 1 ? ` × ${l.quantity}` : ""}`}
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
          <Link
            href={`/contact`}
            className="flex min-h-14 w-full items-center justify-center bg-charcoal px-8 text-[0.74rem] font-semibold uppercase tracking-[0.16em] text-ivory transition-colors hover:bg-walnut"
          >
            Contact Us About This Piece
          </Link>
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
              {showTotal ? <p className="text-sm nums text-muted">Est. {formatCents(total!)}</p> : null}
            </div>
            <button
              type="button"
              tabIndex={ctaVisible ? -1 : 0}
              onClick={requestConfiguration}
              className="min-h-12 shrink-0 bg-charcoal px-5 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-ivory"
            >
              {mode === "cart" ? "Add to Cart" : "Request"}
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
  onSelect,
  onCustomText,
  error,
  pricesVisible,
}: {
  group: ConfigOptionGroup;
  selectedId: string | null;
  customText: string;
  onSelect: (id: string | null) => void;
  onCustomText: (t: string) => void;
  error?: string;
  pricesVisible: boolean;
}) {
  const name = useId();
  const selected = group.values.find((v) => v.id === selectedId);
  const mod = (cents: number) => (pricesVisible && cents !== 0 ? formatModifier(cents) : "");
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
                {mod(v.priceModifierCents) ? ` (${mod(v.priceModifierCents)})` : ""}
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
              {mod(v.priceModifierCents) ? <span className="-mt-1.5 text-[0.7rem] text-muted">{mod(v.priceModifierCents)}</span> : null}
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
                <span className="block px-0.5 pb-0.5 text-[0.72rem] text-muted">{mod(v.priceModifierCents) || (v.isCustom ? "Quoted" : " ")}</span>
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
              <span className="text-sm nums text-muted">{mod(v.priceModifierCents)}</span>
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
                {v.description || mod(v.priceModifierCents) ? (
                  <span className="mt-0.5 text-[0.72rem] leading-snug opacity-75">
                    {[v.description, mod(v.priceModifierCents)].filter(Boolean).join(" · ")}
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
        selectedLabel={selected ? `${selected.displayName}${mod(selected.priceModifierCents) ? ` · ${mod(selected.priceModifierCents)}` : ""}` : undefined}
      />
      {group.description ? <p className="-mt-2 mb-4 text-sm text-muted">{group.description}</p> : null}
      {control}
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
  onServerErrors,
}: {
  product: ConfigurableProduct;
  selection: ConfigurationSelection;
  pricing: ReturnType<typeof priceConfiguration>;
  showTotal: boolean;
  copy: { heading: string | null; body: string | null };
  confirmation: { heading: string | null; body: string | null };
  onServerErrors: (e: Record<string, string>) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const opts = useMemo(
    () => ({
      prepare: (fd: FormData) => {
        fd.set("productId", product.id);
        fd.set("selection", JSON.stringify(selection));
        fd.delete("attachments");
        files.forEach((f) => fd.append("attachments", f));
      },
      validate: validateRequest,
    }),
    [product.id, selection, files],
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
        return (
          <div key={g.id} className="contents">
            <dt className="text-muted">{g.displayName}</dt>
            <dd>
              {v.displayName}
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
        <p className="mt-3 leading-relaxed text-muted">
          {confirmation.body || "We've received your request and will be in touch soon."}
        </p>
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
      {copy.body ? <p className="mt-3 leading-relaxed text-muted">{copy.body}</p> : null}

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
        </div>
        <SelectField label="Desired timeline" name="timeline" options={TIMELINE_OPTIONS.map((t) => ({ value: t, label: t }))} error={fieldErrors.timeline} />
        <TextAreaField label="Notes" name="notes" rows={4} maxLength={4000} error={fieldErrors.notes} placeholder="Anything else we should know — room size, questions, special requests." />
        <ReferenceImagesField files={files} onChange={setFiles} error={fieldErrors.attachments} />
        <SubmitButton pending={pending} className="w-full" pendingLabel="Sending request…">
          Send Request
        </SubmitButton>
        <p className="text-xs text-muted">
          No payment is required. We&apos;ll use your details only to respond to this request — see our{" "}
          <Link href="/privacy" className="link-quiet">
            privacy policy
          </Link>
          .
        </p>
      </div>
    </form>
  );
}
