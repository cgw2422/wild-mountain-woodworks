import type { ConfigurableProduct, ConfigurationSelection, PricingResult } from "./types";

/**
 * An immutable record of exactly what a customer configured, captured at the
 * moment a quote (or, later, an order) is created. Stored as JSON on
 * QuoteRequest.configuration and OrderItem.configuration.
 *
 * Every human-readable name and every price is COPIED here so later edits to
 * products, option groups, values or add-ons never rewrite history.
 */
export interface ConfigurationSnapshot {
  version: 1;
  capturedAt: string;
  currency: "usd";
  product: { id: string; name: string; slug: string; sku: string | null };
  /** The base price charged — the sale price when a sale was active. */
  basePriceCents: number | null;
  /** Present when a sale was active at submission (absent on older snapshots). */
  sale?: { regularBasePriceCents: number; savingsCents: number } | null;
  options: Array<{
    groupId: string;
    groupName: string;
    groupDisplayName: string;
    valueId: string;
    valueName: string;
    valueDisplayName: string;
    priceModifierCents: number;
    isCustom: boolean;
    customDetails: string | null;
  }>;
  addOns: Array<{
    addOnId: string;
    name: string;
    unitPriceCents: number;
    quantity: number;
    totalCents: number;
  }>;
  totalCents: number | null;
  requiresCustomQuote: boolean;
  /** Whether the price was visible to the customer when they submitted. */
  priceShownToCustomer: boolean;
}

export function buildConfigurationSnapshot(
  product: ConfigurableProduct,
  selection: ConfigurationSelection,
  pricing: PricingResult,
  opts: { priceShownToCustomer: boolean; now?: Date },
): ConfigurationSnapshot {
  if (!pricing.valid) throw new Error("Cannot snapshot an invalid configuration");

  const options: ConfigurationSnapshot["options"] = [];
  for (const group of product.optionGroups) {
    const valueId = selection.options[group.id];
    const value = valueId ? group.values.find((v) => v.id === valueId) : undefined;
    if (!value) continue;
    options.push({
      groupId: group.id,
      groupName: group.name,
      groupDisplayName: group.displayName,
      valueId: value.id,
      valueName: value.name,
      valueDisplayName: value.displayName,
      priceModifierCents: value.priceModifierCents,
      isCustom: value.isCustom,
      customDetails: value.isCustom ? (selection.customDetails?.[group.id]?.trim() || null) : null,
    });
  }

  const addOns: ConfigurationSnapshot["addOns"] = [];
  for (const addOn of product.addOns) {
    const qty = Math.trunc(selection.addOns[addOn.id] ?? 0);
    if (qty <= 0) continue;
    addOns.push({
      addOnId: addOn.id,
      name: addOn.name,
      unitPriceCents: addOn.priceCents,
      quantity: qty,
      totalCents: addOn.priceCents * qty,
    });
  }

  return {
    version: 1,
    capturedAt: (opts.now ?? new Date()).toISOString(),
    currency: "usd",
    product: { id: product.id, name: product.name, slug: product.slug, sku: product.sku },
    basePriceCents: product.basePriceCents,
    sale: product.sale ? { regularBasePriceCents: product.sale.regularBasePriceCents, savingsCents: pricing.savingsCents } : null,
    options,
    addOns,
    totalCents: pricing.totalCents,
    requiresCustomQuote: pricing.requiresCustomQuote,
    priceShownToCustomer: opts.priceShownToCustomer,
  };
}

/** Narrow unknown JSON (from the database) to a snapshot, or null. */
export function parseSnapshot(value: unknown): ConfigurationSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<ConfigurationSnapshot>;
  if (v.version !== 1 || !v.product || !Array.isArray(v.options) || !Array.isArray(v.addOns)) return null;
  return v as ConfigurationSnapshot;
}
