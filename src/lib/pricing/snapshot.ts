import { applyConditionalPrices, chosenQuantity } from "./engine";
import type { ConfigurableProduct, ConfigurationSelection, OptionPriceRule, PricingResult } from "./types";

/**
 * When a conditional rule set a price: the controlling choice (names copied)
 * and the value's default price at the time. Absent = the default price
 * applied (and on snapshots from before conditional pricing).
 */
export interface SnapshotPriceCondition {
  dependsOnGroupId: string;
  dependsOnGroupName: string;
  dependsOnValueId: string;
  dependsOnValueName: string;
  defaultPriceModifierCents: number;
}

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
  /** `percent`: the entered percentage for percent sales (null for fixed-price sales). */
  sale?: { regularBasePriceCents: number; savingsCents: number; label?: string | null; percent?: number | null } | null;
  options: Array<{
    groupId: string;
    groupName: string;
    groupDisplayName: string;
    valueId: string;
    valueName: string;
    valueDisplayName: string;
    /** Per unit for quantity-based values; otherwise the whole modifier. */
    priceModifierCents: number;
    isCustom: boolean;
    customDetails: string | null;
    /** Quantity-based values only (absent on ordinary values and older snapshots). */
    quantity?: number;
    unitPriceCents?: number;
    totalCents?: number;
    /** Set when a conditional price applied (e.g. Match Tabletop +$750 because Walnut was chosen). */
    priceCondition?: SnapshotPriceCondition;
  }>;
  addOns: Array<{
    addOnId: string;
    name: string;
    /** Per unit — for configurable add-ons, the configured price (base + choices). */
    unitPriceCents: number;
    quantity: number;
    totalCents: number;
    /** Configurable add-ons only (absent on simple add-ons and older snapshots). */
    basePriceCents?: number;
    choices?: Array<{ groupId: string; groupName: string; label: string; valueId: string; value: string; priceModifierCents: number; priceCondition?: SnapshotPriceCondition }>;
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
  // Prices in effect for this selection — the same numbers priceConfiguration charged.
  const priced = applyConditionalPrices(product, selection);
  const condition = (rule: OptionPriceRule | null | undefined, defaultCents: number | undefined, extraGroups: ConfigurableProduct["optionGroups"] = []): { priceCondition?: SnapshotPriceCondition } => {
    if (!rule) return {};
    const group = [...extraGroups, ...priced.optionGroups].find((g) => g.id === rule.dependsOnGroupId);
    const value = group?.values.find((v) => v.id === rule.dependsOnValueId);
    return {
      priceCondition: {
        dependsOnGroupId: rule.dependsOnGroupId,
        dependsOnGroupName: group?.displayName ?? "",
        dependsOnValueId: rule.dependsOnValueId,
        dependsOnValueName: value?.displayName ?? "",
        defaultPriceModifierCents: defaultCents ?? 0,
      },
    };
  };

  const options: ConfigurationSnapshot["options"] = [];
  for (const group of priced.optionGroups) {
    const valueId = selection.options[group.id];
    const value = valueId ? group.values.find((v) => v.id === valueId) : undefined;
    if (!value) continue;
    const qty = value.quantity ? chosenQuantity(value, selection, group.id) : null;
    // A quantity-based choice of zero (e.g. no chairs) isn't part of the order.
    if (qty === 0) continue;
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
      ...(qty != null ? { quantity: qty, unitPriceCents: value.priceModifierCents, totalCents: value.priceModifierCents * qty } : {}),
      ...condition(value.appliedRule, value.defaultPriceModifierCents),
    });
  }

  const addOns: ConfigurationSnapshot["addOns"] = [];
  for (const addOn of priced.addOns) {
    const qty = Math.trunc(selection.addOns[addOn.id] ?? 0);
    if (qty <= 0) continue;
    // Configurable add-ons: copy the priced line (configured unit price + each choice) from the engine.
    const line = pricing.lines.find((l) => l.kind === "addon" && l.addOn?.addOnId === addOn.id);
    if (line?.addOn) {
      const groups = new Map(addOn.optionGroups.map((g) => [g.id, g]));
      addOns.push({
        addOnId: addOn.id,
        name: addOn.name,
        unitPriceCents: line.unitCents,
        quantity: qty,
        totalCents: line.amountCents,
        basePriceCents: line.addOn.basePriceCents,
        choices: line.addOn.choices.map((c) => {
          const valueId = selection.addOnOptions?.[addOn.id]?.[c.groupId] ?? "";
          const chosen = groups.get(c.groupId)?.values.find((v) => v.id === valueId);
          return {
            groupId: c.groupId,
            groupName: groups.get(c.groupId)?.name ?? c.label,
            label: c.label,
            valueId,
            value: c.value,
            priceModifierCents: c.priceModifierCents,
            ...condition(c.conditional, chosen?.defaultPriceModifierCents, addOn.optionGroups),
          };
        }),
      });
      continue;
    }
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
    sale: product.sale
      ? { regularBasePriceCents: product.sale.regularBasePriceCents, savingsCents: pricing.savingsCents, label: product.sale.label, percent: product.sale.percent }
      : null,
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

type SnapshotOption = ConfigurationSnapshot["options"][number];

/** What an option adds to the price: unit × quantity for quantity-based values, else its modifier (older snapshots too). */
export function snapshotOptionTotal(o: SnapshotOption): number {
  return o.quantity != null ? (o.totalCents ?? (o.unitPriceCents ?? o.priceModifierCents) * o.quantity) : o.priceModifierCents;
}

/** "Cross Back Chair × 4" for quantity-based values, else the value name. */
export function snapshotOptionLabel(o: SnapshotOption): string {
  return o.quantity != null ? `${o.valueDisplayName} × ${o.quantity}` : o.valueDisplayName;
}

/**
 * A configured add-on as it travels on quote, order and invoice lines
 * (QuoteLineItem / OrderItem / InvoiceLineItem `addOn`), so the add-on stays
 * grouped under its main product with every choice intact.
 */
export interface AddOnLineDetails {
  version: 1;
  addOnId: string;
  name: string;
  /** The main product this add-on belongs to. */
  parentProduct: { id: string; name: string };
  basePriceCents: number;
  unitPriceCents: number;
  choices: Array<{ label: string; value: string; priceModifierCents: number }>;
}

export function addOnLineDetails(s: ConfigurationSnapshot, a: ConfigurationSnapshot["addOns"][number]): AddOnLineDetails | null {
  if (!a.choices) return null;
  return {
    version: 1,
    addOnId: a.addOnId,
    name: a.name,
    parentProduct: { id: s.product.id, name: s.product.name },
    basePriceCents: a.basePriceCents ?? a.unitPriceCents,
    unitPriceCents: a.unitPriceCents,
    choices: a.choices.map((c) => ({ label: c.label, value: c.value, priceModifierCents: c.priceModifierCents })),
  };
}

/** Narrow unknown JSON (a line's `addOn` column) to add-on details, or null. */
export function parseAddOnLine(value: unknown): AddOnLineDetails | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<AddOnLineDetails>;
  if (v.version !== 1 || typeof v.name !== "string" || !Array.isArray(v.choices)) return null;
  return v as AddOnLineDetails;
}

/** "Style: X Back\nWood Species: Oak\n…" — readable notes for a configured add-on line. */
export function addOnChoicesText(choices: Array<{ label: string; value: string }>): string {
  return choices.map((c) => `${c.label}: ${c.value}`).join("\n");
}
