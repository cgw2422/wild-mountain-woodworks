import type {
  AddOnChoicePrice,
  ConfigAddOn,
  ConfigOptionGroup,
  ConfigOptionValue,
  ConfigurableProduct,
  ConfigurationSelection,
  OptionPriceRule,
  OptionQuantitySpec,
  PriceLine,
  PricingResult,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Conditional option pricing                                                  */
/* -------------------------------------------------------------------------- */

/** Selected values by group id (product options, plus an add-on's own picks for add-on groups). */
export type SelectedValues = Record<string, string>;

/**
 * THE price of one option value given what else is selected: the first of
 * its conditional rules whose controlling value is selected (e.g. Match
 * Tabletop +$750 while Table Top Wood = Walnut), otherwise its default price
 * (the library price or the product's override). Per unit for quantity-based
 * values. Never discounted by a product sale — sales apply to the base only.
 */
export function optionValuePrice(value: ConfigOptionValue, selected: SelectedValues): { priceModifierCents: number; rule: OptionPriceRule | null } {
  for (const rule of value.priceRules ?? []) {
    if (selected[rule.dependsOnGroupId] === rule.dependsOnValueId) return { priceModifierCents: rule.priceModifierCents, rule };
  }
  return { priceModifierCents: value.defaultPriceModifierCents ?? value.priceModifierCents, rule: null };
}

function priceGroups(groups: ConfigOptionGroup[], selected: SelectedValues): ConfigOptionGroup[] {
  return groups.map((g) =>
    g.values.some((v) => v.priceRules?.length)
      ? {
          ...g,
          values: g.values.map((v) => {
            if (!v.priceRules?.length) return v;
            const p = optionValuePrice(v, selected);
            return { ...v, priceModifierCents: p.priceModifierCents, defaultPriceModifierCents: v.defaultPriceModifierCents ?? v.priceModifierCents, appliedRule: p.rule };
          }),
        }
      : g,
  );
}

const hasRules = (groups: ConfigOptionGroup[]) => groups.some((g) => g.values.some((v) => v.priceRules?.length));

/**
 * The product with every option value priced for this selection: each
 * value's `priceModifierCents` becomes the price in effect (conditional rule
 * or default). Rules on an add-on's own choices see the add-on's picks and
 * the product's options. Idempotent; returns the product unchanged when no
 * value has rules. The configurator renders from this, so the upcharge shown
 * beside a value is exactly what priceConfiguration charges.
 */
export function applyConditionalPrices(product: ConfigurableProduct, selection: Pick<ConfigurationSelection, "options" | "addOnOptions">): ConfigurableProduct {
  if (!hasRules(product.optionGroups) && !product.addOns.some((a) => hasRules(a.optionGroups))) return product;
  const options = selection.options ?? {};
  return {
    ...product,
    optionGroups: priceGroups(product.optionGroups, options),
    addOns: product.addOns.map((a) => (hasRules(a.optionGroups) ? { ...a, optionGroups: priceGroups(a.optionGroups, { ...options, ...selection.addOnOptions?.[a.id] }) } : a)),
  };
}

/**
 * A concrete, cheap combination of the given groups for "From" prices: the
 * cheapest value of each group by default price, then re-chosen a few times
 * with conditional prices in effect. Always an achievable combination.
 */
function cheapPicks(groups: ConfigOptionGroup[], weight: (v: ConfigOptionValue) => number, context: SelectedValues = {}): SelectedValues {
  const picks: SelectedValues = {};
  const pick = (g: ConfigOptionGroup, price: (v: ConfigOptionValue) => number) => {
    let best: ConfigOptionValue | undefined;
    for (const v of g.values) if (!v.isCustom && (!best || price(v) * weight(v) < price(best) * weight(best))) best = v;
    if (best) picks[g.id] = best.id;
  };
  for (const g of groups) pick(g, (v) => v.defaultPriceModifierCents ?? v.priceModifierCents);
  for (let pass = 0; pass < 3; pass++) for (const g of groups) pick(g, (v) => optionValuePrice(v, { ...context, ...picks }).priceModifierCents);
  return picks;
}

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
  choices: AddOnChoicePrice[];
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
 * Each value's price is its conditional price where a rule matches (rules
 * see this add-on's picks and the product's `productOptions`), else its
 * default (optionValuePrice).
 *
 * Quantity is NOT applied here: the add-on total is unit × quantity, once, by
 * the caller (priceConfiguration). The configurator, the server re-pricing,
 * snapshots, quote/order/invoice lines and emails all derive from this.
 */
export function configuredAddOnUnitPrice(addOn: ConfigAddOn, picks: Record<string, string>, productOptions: SelectedValues = {}): ConfiguredAddOnPrice {
  const errors: Record<string, string> = {};
  const groups = priceGroups(addOn.optionGroups, { ...productOptions, ...picks });
  const known = new Set(groups.map((g) => g.id));
  const unknownChoice = Object.keys(picks).some((g) => !known.has(g));
  const priceGroup = groups.find((g) => g.setsUnitPrice);
  let basePriceCents = addOn.priceCents;
  let adjustments = 0;
  let complete = true;
  const choices: ConfiguredAddOnPrice["choices"] = [];
  for (const group of groups) {
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
    choices.push({
      groupId: group.id,
      label: group.displayName,
      value: value.displayName,
      priceModifierCents: value.priceModifierCents,
      ...(group === priceGroup ? { setsUnitPrice: true } : {}),
      ...(value.appliedRule ? { conditional: value.appliedRule } : {}),
    });
  }
  return { unitCents: complete ? basePriceCents + adjustments : null, basePriceCents, choices, errors, unknownChoice };
}

/** "From" price of one configured unit: a cheap achievable combination of the required groups (and the unit-price group), conditional prices included. */
export function cheapestAddOnUnitPrice(addOn: ConfigAddOn, productOptions: SelectedValues = {}): number {
  const counted = addOn.optionGroups.filter((g) => (g.required || g.setsUnitPrice) && g.values.length);
  const picks = cheapPicks(counted, () => 1, productOptions);
  const priced = configuredAddOnUnitPrice({ ...addOn, optionGroups: counted }, picks, productOptions);
  return priced.unitCents ?? addOn.priceCents;
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
 *   base price (the SALE price while a sale is active — the only discounted part)
 *     + Σ option prices (conditional price where a rule matches, else the default;
 *                        × quantity for quantity-based values) — never discounted
 *     + Σ (add-on unit price × quantity)
 *
 * The sale base price is applied by resolveConfigurableProduct with the
 * server's clock, so a 30% sale on $1,599 with +$200 and +$150 options is
 * $1,119.30 + $200 + $150, never ($1,599 + $350) × 70%.
 *
 * Pure and deterministic. Used by the configurator for live estimates and by
 * the server (with freshly loaded data) as the source of truth for quotes and,
 * later, orders.
 */
export function priceConfiguration(
  input: ConfigurableProduct,
  selection: ConfigurationSelection,
): PricingResult {
  // Every value priced for this selection (conditional rules), exactly as the configurator displays it.
  const product = applyConditionalPrices(input, selection);
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
        ...(value.appliedRule ? { conditional: value.appliedRule } : {}),
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
      ...(value.appliedRule ? { conditional: value.appliedRule } : {}),
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
    const priced = configuredAddOnUnitPrice(addOn, selection.addOnOptions?.[addOn.id] ?? {}, selection.options ?? {});
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
  // The cheapest required choices — a real combination, with conditional prices in effect.
  const required = product.optionGroups.filter((g) => g.required && g.values.some((v) => !v.isCustom));
  const qtyOf = (v: ConfigOptionValue) => (v.quantity ? v.quantity.min : 1);
  const picks = cheapPicks(required, qtyOf);
  for (const group of required) {
    const value = group.values.find((v) => v.id === picks[group.id]);
    if (value) total += optionValuePrice(value, picks).priceModifierCents * qtyOf(value);
  }
  for (const addOn of product.addOns) {
    const min = addOn.required ? Math.max(1, addOn.minQuantity) : addOn.minQuantity;
    total += (addOn.optionGroups.length ? cheapestAddOnUnitPrice(addOn, picks) : addOn.priceCents) * min;
  }
  return total;
}
