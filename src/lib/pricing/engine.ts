import type {
  ConfigurableProduct,
  ConfigurationSelection,
  PriceLine,
  PricingResult,
} from "./types";

/**
 * Validate a selection against a configurable product and calculate its price:
 *
 *   base price + Σ option modifiers + Σ (add-on price × quantity)
 *
 * Pure and deterministic. Used by the configurator for live estimates and by
 * the server (with freshly loaded data) as the source of truth for quotes and,
 * later, orders.
 */
export function priceConfiguration(
  product: ConfigurableProduct,
  selection: ConfigurationSelection,
): PricingResult {
  const errors: Record<string, string> = {};
  const lines: PriceLine[] = [];
  let requiresCustomQuote = false;

  const base = product.basePriceCents;
  lines.push({
    kind: "base",
    label: product.name,
    detail: "Base price",
    quantity: 1,
    unitCents: base ?? 0,
    amountCents: base ?? 0,
  });

  const knownGroups = new Set(product.optionGroups.map((g) => g.id));
  for (const groupId of Object.keys(selection.options ?? {})) {
    if (!knownGroups.has(groupId)) errors._form = "The configuration contains an option that is no longer available.";
  }

  for (const group of product.optionGroups) {
    const valueId = selection.options?.[group.id];
    if (!valueId) {
      if (group.required) errors[group.id] = `Please choose a ${group.displayName.toLowerCase()}.`;
      continue;
    }
    const value = group.values.find((v) => v.id === valueId);
    if (!value) {
      errors[group.id] = `That ${group.displayName.toLowerCase()} is not available for this piece.`;
      continue;
    }
    if (value.isCustom) {
      requiresCustomQuote = true;
      const details = selection.customDetails?.[group.id]?.trim();
      if (!details) errors[group.id] = `Please describe your custom ${group.displayName.toLowerCase()}.`;
    }
    lines.push({
      kind: "option",
      label: group.displayName,
      detail: value.displayName,
      quantity: 1,
      unitCents: value.priceModifierCents,
      amountCents: value.priceModifierCents,
    });
  }

  const knownAddOns = new Set(product.addOns.map((a) => a.id));
  for (const addOnId of Object.keys(selection.addOns ?? {})) {
    if (!knownAddOns.has(addOnId) && (selection.addOns[addOnId] ?? 0) > 0) {
      errors._form = "The configuration contains an add-on that is no longer available.";
    }
  }

  for (const addOn of product.addOns) {
    const raw = selection.addOns?.[addOn.id] ?? 0;
    const qty = Number.isFinite(raw) ? Math.trunc(raw) : 0;
    const min = addOn.required ? Math.max(1, addOn.minQuantity) : addOn.minQuantity;
    if (qty < 0 || qty > addOn.maxQuantity) {
      errors[addOn.id] = `Choose between ${min} and ${addOn.maxQuantity}.`;
      continue;
    }
    if (qty < min) {
      errors[addOn.id] = addOn.required ? `${addOn.name} is required.` : `Choose at least ${min}.`;
      continue;
    }
    if (qty === 0) continue;
    lines.push({
      kind: "addon",
      label: addOn.name,
      quantity: qty,
      unitCents: addOn.priceCents,
      amountCents: addOn.priceCents * qty,
    });
  }

  const totalCents = base == null ? null : lines.reduce((sum, l) => sum + l.amountCents, 0);

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    lines,
    totalCents,
    requiresCustomQuote,
  };
}

/** A selection pre-filled with each group's default (or first) value. */
export function defaultSelection(product: ConfigurableProduct): ConfigurationSelection {
  const options: Record<string, string> = {};
  for (const group of product.optionGroups) {
    const def = group.values.find((v) => v.isDefault) ?? (group.required ? group.values.find((v) => !v.isCustom) : undefined);
    if (def) options[group.id] = def.id;
  }
  const addOns: Record<string, number> = {};
  for (const addOn of product.addOns) {
    const min = addOn.required ? Math.max(1, addOn.minQuantity) : addOn.minQuantity;
    if (min > 0) addOns[addOn.id] = min;
  }
  return { options, addOns, customDetails: {} };
}

/** "From" price: base + cheapest required choices + required add-ons. */
export function startingPrice(product: ConfigurableProduct): number | null {
  if (product.basePriceCents == null) return null;
  let total = product.basePriceCents;
  for (const group of product.optionGroups) {
    if (!group.required) continue;
    const priced = group.values.filter((v) => !v.isCustom).map((v) => v.priceModifierCents);
    if (priced.length) total += Math.min(...priced);
  }
  for (const addOn of product.addOns) {
    const min = addOn.required ? Math.max(1, addOn.minQuantity) : addOn.minQuantity;
    total += addOn.priceCents * min;
  }
  return total;
}
