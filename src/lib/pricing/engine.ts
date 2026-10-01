import type {
  ConfigAddOn,
  ConfigOptionValue,
  ConfigurableProduct,
  ConfigurationSelection,
  OptionQuantitySpec,
  PriceLine,
  PricingResult,
} from "./types";

/** The quantity in effect for a chosen value: the customer's, else the value's default (1 for ordinary values). */
export function chosenQuantity(value: Pick<ConfigOptionValue, "quantity">, selection: ConfigurationSelection, groupId: string): number {
  if (!value.quantity) return 1;
  const raw = selection.optionQuantities?.[groupId];
  return raw === undefined || raw === null ? value.quantity.default : Number(raw);
}

/** Why a quantity isn't allowed (null when it is): whole number, within min–max, on the step grid from min. */
export function quantityIssue(q: number, spec: OptionQuantitySpec): string | null {
  const range = spec.step > 1 ? `between ${spec.min} and ${spec.max}, in steps of ${spec.step}` : `between ${spec.min} and ${spec.max}`;
  if (!Number.isInteger(q) || q < spec.min || q > spec.max || (q - spec.min) % spec.step !== 0) return `Choose a quantity ${range}.`;
  return null;
}

/** Error / field key for one option group inside a configurable add-on. */
export function addOnFieldKey(addOnId: string, groupId: string) {
  return `${addOnId}.${groupId}`;
}

export interface ConfiguredAddOnPrice {
  /** Price of ONE configured unit (e.g. one chair); null while a required choice is missing or invalid. */
  unitCents: number | null;
  /** What the unit price starts from: the chosen value of the "sets the price" group, else the add-on base. */
  basePriceCents: number;
  choices: Array<{ groupId: string; label: string; value: string; priceModifierCents: number; setsUnitPrice?: boolean }>;
  /** Field errors keyed by addOnFieldKey(addOn, group). */
  errors: Record<string, string>;
  unknownChoice: boolean;
}

/**
 * THE canonical price of one configured add-on unit (e.g. one chair):
 *
 *   unit = (chosen value of the group that sets the unit price, e.g. Chair Style
 *           — or the add-on's base price when no group does)
 *        + Σ the other chosen values' adjustments (wood, chair finish, seat finish…)
 *
 * Quantity is NOT applied here: the add-on total is unit × quantity, once, by
 * the caller (priceConfiguration). The configurator, the server re-pricing,
 * snapshots, quote/order/invoice lines and emails all derive from this.
 */
export function configuredAddOnUnitPrice(addOn: ConfigAddOn, picks: Record<string, string>): ConfiguredAddOnPrice {
  const errors: Record<string, string> = {};
  const known = new Set(addOn.optionGroups.map((g) => g.id));
  const unknownChoice = Object.keys(picks).some((g) => !known.has(g));
  const priceGroup = addOn.optionGroups.find((g) => g.setsUnitPrice);
  let basePriceCents = addOn.priceCents;
  let adjustments = 0;
  let complete = true;
  const choices: ConfiguredAddOnPrice["choices"] = [];
  for (const group of addOn.optionGroups) {
    const key = addOnFieldKey(addOn.id, group.id);
    const valueId = picks[group.id];
    if (!valueId) {
      if (group.required || group === priceGroup) {
        errors[key] = `Please choose a ${group.displayName.toLowerCase()}.`;
        complete = false;
      }
      continue;
    }
    const value = group.values.find((v) => v.id === valueId);
    if (!value) {
      errors[key] = `That ${group.displayName.toLowerCase()} is not available.`;
      complete = false;
      continue;
    }
    if (group === priceGroup) basePriceCents = value.priceModifierCents;
    else adjustments += value.priceModifierCents;
    choices.push({ groupId: group.id, label: group.displayName, value: value.displayName, priceModifierCents: value.priceModifierCents, ...(group === priceGroup ? { setsUnitPrice: true } : {}) });
  }
  return { unitCents: complete ? basePriceCents + adjustments : null, basePriceCents, choices, errors, unknownChoice };
}

/** Lowest possible price of one configured unit (cheapest choice in each required group). */
export function cheapestAddOnUnitPrice(addOn: ConfigAddOn): number {
  const priceGroup = addOn.optionGroups.find((g) => g.setsUnitPrice && g.values.length);
  let unit = priceGroup ? Math.min(...priceGroup.values.map((v) => v.priceModifierCents)) : addOn.priceCents;
  for (const g of addOn.optionGroups) if (g !== priceGroup && g.required && g.values.length) unit += Math.min(...g.values.map((v) => v.priceModifierCents));
  return unit;
}

/** First available value per required group of an add-on (used when the customer adds it). */
export function defaultAddOnChoices(addOn: ConfigurableProduct["addOns"][number]): Record<string, string> {
  const picks: Record<string, string> = {};
  for (const g of addOn.optionGroups) if ((g.required || g.setsUnitPrice) && g.values[0]) picks[g.id] = g.values[0].id;
  return picks;
}

/**
 * Validate a selection against a configurable product and calculate its price:
 *
 *   base price + Σ option modifiers (× quantity for quantity-based values)
 *              + Σ (add-on price × quantity)
 *
 * The base price is already the sale price when a sale is active (applied by
 * resolveConfigurableProduct with the server's clock).
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
    detail: product.sale ? "Sale price" : "Base price",
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
    if (value.quantity) {
      // Quantity-based (e.g. chairs): price per unit × how many. Zero is fine when allowed (e.g. the table without chairs).
      const qty = chosenQuantity(value, selection, group.id);
      const issue = quantityIssue(qty, value.quantity);
      if (issue) {
        errors[group.id] = issue;
        continue;
      }
      if (qty === 0) continue;
      lines.push({
        kind: "option",
        label: group.displayName,
        detail: value.displayName,
        quantity: qty,
        unitCents: value.priceModifierCents,
        amountCents: value.priceModifierCents * qty,
      });
      continue;
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

  const knownAddOnChoices = new Set(product.addOns.filter((a) => a.optionGroups.length).map((a) => a.id));
  for (const addOnId of Object.keys(selection.addOnOptions ?? {})) {
    if (!knownAddOnChoices.has(addOnId) && Object.keys(selection.addOnOptions?.[addOnId] ?? {}).length) errors._form = "The configuration contains an add-on that is no longer available.";
  }

  for (const addOn of product.addOns) {
    const raw = selection.addOns?.[addOn.id] ?? 0;
    const qty = Number.isFinite(raw) ? Math.trunc(raw) : 0;
    const min = addOn.required ? Math.max(1, addOn.minQuantity) : addOn.minQuantity;
    if (qty < 0 || qty > addOn.maxQuantity) {
      errors[addOn.id] = `Choose between ${min} and ${addOn.maxQuantity}.`;
      continue;
    }
    // An optional configurable add-on (e.g. chairs, at least 2 if added) can always be left out with 0.
    const optedOut = qty === 0 && !addOn.required && addOn.optionGroups.length > 0;
    if (qty < min && !optedOut) {
      errors[addOn.id] = addOn.required ? `${addOn.name} is required.` : `Choose at least ${min}.`;
      continue;
    }
    if (qty > 0 && addOn.quantityStep > 1 && (qty - addOn.minQuantity) % addOn.quantityStep !== 0) {
      errors[addOn.id] = `Choose a quantity in steps of ${addOn.quantityStep} (from ${addOn.minQuantity} to ${addOn.maxQuantity}).`;
      continue;
    }
    if (qty === 0) continue;
    if (!addOn.optionGroups.length) {
      lines.push({
        kind: "addon",
        label: addOn.name,
        quantity: qty,
        unitCents: addOn.priceCents,
        amountCents: addOn.priceCents * qty,
      });
      continue;
    }
    // Configurable add-on: ONE configured unit price, then × quantity (exactly once).
    const priced = configuredAddOnUnitPrice(addOn, selection.addOnOptions?.[addOn.id] ?? {});
    if (priced.unknownChoice) errors._form = "The configuration contains an option that is no longer available.";
    Object.assign(errors, priced.errors);
    if (priced.unitCents == null) {
      errors[addOn.id] = `Please complete the ${addOn.name.toLowerCase()} choices.`;
      continue;
    }
    lines.push({
      kind: "addon",
      label: addOn.name,
      detail: priced.choices.map((c) => c.value).join(" · ") || undefined,
      quantity: qty,
      unitCents: priced.unitCents,
      amountCents: priced.unitCents * qty,
      addOn: { addOnId: addOn.id, basePriceCents: priced.basePriceCents, choices: priced.choices },
    });
  }

  const totalCents = base == null ? null : lines.reduce((sum, l) => sum + l.amountCents, 0);

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    lines,
    totalCents,
    savingsCents: product.sale && base != null ? product.sale.regularBasePriceCents - base : 0,
    requiresCustomQuote,
  };
}

/** A selection pre-filled with each group's default (or first) value. */
export function defaultSelection(product: ConfigurableProduct): ConfigurationSelection {
  const options: Record<string, string> = {};
  const optionQuantities: Record<string, number> = {};
  for (const group of product.optionGroups) {
    const def = group.values.find((v) => v.isDefault) ?? (group.required ? group.values.find((v) => !v.isCustom) : undefined);
    if (def) options[group.id] = def.id;
    if (def?.quantity) optionQuantities[group.id] = def.quantity.default;
  }
  const addOns: Record<string, number> = {};
  const addOnOptions: Record<string, Record<string, string>> = {};
  for (const addOn of product.addOns) {
    const min = addOn.required ? Math.max(1, addOn.minQuantity) : addOn.minQuantity;
    // Configurable add-ons start "not added" unless required (the customer opts in).
    if (addOn.optionGroups.length) {
      if (addOn.required) {
        addOns[addOn.id] = Math.max(min, addOn.defaultQuantity);
        addOnOptions[addOn.id] = defaultAddOnChoices(addOn);
      }
      continue;
    }
    if (min > 0) addOns[addOn.id] = min;
  }
  return { options, optionQuantities, addOns, addOnOptions, customDetails: {} };
}

/**
 * "From" price: base + cheapest required choices + required add-ons.
 * `regular: true` prices it at the regular base price, ignoring a sale.
 */
export function startingPrice(product: ConfigurableProduct, opts: { regular?: boolean } = {}): number | null {
  if (product.basePriceCents == null) return null;
  let total = opts.regular && product.sale ? product.sale.regularBasePriceCents : product.basePriceCents;
  for (const group of product.optionGroups) {
    if (!group.required) continue;
    const priced = group.values.filter((v) => !v.isCustom).map((v) => v.priceModifierCents * (v.quantity ? v.quantity.min : 1));
    if (priced.length) total += Math.min(...priced);
  }
  for (const addOn of product.addOns) {
    const min = addOn.required ? Math.max(1, addOn.minQuantity) : addOn.minQuantity;
    total += (addOn.optionGroups.length ? cheapestAddOnUnitPrice(addOn) : addOn.priceCents) * min;
  }
  return total;
}
