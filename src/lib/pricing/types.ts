/**
 * Types for the configuration/pricing engine.
 *
 * A `ConfigurableProduct` is the fully-resolved, customer-facing view of a
 * product: global option groups/values with the product's overrides already
 * applied, and add-ons with per-product overrides applied. It is produced by
 * `resolveConfigurableProduct` (pure) from database records.
 *
 * This module is framework-agnostic and safe to import from client code so
 * the configurator can show a live estimate. The SERVER always recomputes
 * with fresh database values — browser-submitted prices are never trusted.
 */

export type OptionInputType = "BUTTONS" | "IMAGE" | "SWATCH" | "DROPDOWN" | "RADIO";

export interface ConfigImage {
  url: string;
  alt: string;
  width: number;
  height: number;
  focalX?: number;
  focalY?: number;
  blurDataUrl?: string | null;
}

/**
 * A quantity-based value: the customer also chooses how many (e.g. 0–8 chairs
 * in steps of 1), and `priceModifierCents` is charged per unit.
 */
export interface OptionQuantitySpec {
  min: number;
  max: number;
  step: number;
  default: number;
}

/**
 * Conditional price: while `dependsOnValueId` (a value of group
 * `dependsOnGroupId`) is selected, this value's price is `priceModifierCents`
 * instead of its default. The first matching rule wins.
 */
export interface OptionPriceRule {
  dependsOnGroupId: string;
  dependsOnValueId: string;
  priceModifierCents: number;
}

export interface ConfigOptionValue {
  id: string; // OptionValue.id
  name: string;
  displayName: string;
  description: string | null;
  /**
   * Added to the base price — per unit when `quantity` is set. After
   * applyConditionalPrices (engine.ts) this is the price IN EFFECT for the
   * current selection; the default is kept in `defaultPriceModifierCents`.
   */
  priceModifierCents: number;
  /** Conditional prices, in order (absent/empty = always the default price). */
  priceRules?: OptionPriceRule[];
  /** Set by applyConditionalPrices: the value's own (default or per-product) price. */
  defaultPriceModifierCents?: number;
  /** Set by applyConditionalPrices when a rule decided the price. */
  appliedRule?: OptionPriceRule | null;
  /** Set for quantity-based values (style + how many); null for ordinary values. */
  quantity: OptionQuantitySpec | null;
  isCustom: boolean;
  isDefault: boolean;
  swatchColor: string | null;
  image: ConfigImage | null;
}

export interface ConfigOptionGroup {
  id: string; // OptionGroup.id
  name: string;
  displayName: string;
  description: string | null;
  inputType: OptionInputType;
  required: boolean;
  values: ConfigOptionValue[];
  /**
   * Add-on groups only: the chosen value's price IS the price per unit (e.g.
   * Chair Style: X Back $192.50 each) instead of an adjustment to the base.
   */
  setsUnitPrice?: boolean;
}

export interface ConfigAddOn {
  id: string; // AddOn.id
  /** Customer-facing name (display name, else internal name). */
  name: string;
  description: string | null;
  /** Base price per unit (before the add-on's own option adjustments). */
  priceCents: number;
  required: boolean;
  minQuantity: number;
  maxQuantity: number;
  /** Quantity step (e.g. 2 for pairs); counts from the minimum. */
  quantityStep: number;
  /** Quantity pre-filled when the customer adds it. */
  defaultQuantity: number;
  /** False = a yes/no add-on (quantity fixed at 1). */
  quantityEnabled: boolean;
  image: ConfigImage | null;
  /**
   * Configurable add-ons (e.g. Dining Chairs): the add-on's OWN option groups
   * (style, wood, chair finish, seat finish…). Empty for simple add-ons.
   * Their value adjustments are per unit: unit = priceCents + Σ adjustments.
   */
  optionGroups: ConfigOptionGroup[];
}

export interface ConfigurableProduct {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  /** The base price charged now — the sale price while a sale is active. */
  basePriceCents: number | null;
  /**
   * Set while a sale is active: the regular base price, when it ends, its
   * label, and — for percent sales — the entered percentage, which is what
   * is advertised (never recalculated from the rounded price).
   */
  sale: { regularBasePriceCents: number; endsAt: string | null; label: string | null; percent: number | null } | null;
  optionGroups: ConfigOptionGroup[];
  addOns: ConfigAddOn[];
}

/** What the customer picked. Keys are OptionGroup / AddOn ids. */
export interface ConfigurationSelection {
  options: Record<string, string>;
  /** How many of the chosen value, for quantity-based values (keyed by OptionGroup id). Missing → the value's default. */
  optionQuantities?: Record<string, number>;
  addOns: Record<string, number>;
  /** Choices for configurable add-ons: addOnId → (option group id → value id). */
  addOnOptions?: Record<string, Record<string, string>>;
  /** Free-text details for "custom" option values, keyed by OptionGroup id. */
  customDetails?: Record<string, string>;
}

/** One priced choice inside a configurable add-on. */
export interface AddOnChoicePrice {
  groupId: string;
  label: string;
  value: string;
  priceModifierCents: number;
  setsUnitPrice?: boolean;
  /** The conditional rule that set this price (absent = the value's default price). */
  conditional?: OptionPriceRule;
}

export type PriceLineKind = "base" | "option" | "addon";

export interface PriceLine {
  kind: PriceLineKind;
  label: string;
  detail?: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
  /** Configurable add-ons: the choices that make up `unitCents` (base + adjustments). */
  addOn?: { addOnId: string; basePriceCents: number; choices: AddOnChoicePrice[] };
  /** Options: the conditional rule that set this price (absent = the value's default price). */
  conditional?: OptionPriceRule;
}

export interface PricingResult {
  valid: boolean;
  /** Field-level problems keyed by group/add-on id, or "_form". */
  errors: Record<string, string>;
  lines: PriceLine[];
  /** null when the product has no base price (price on request). */
  totalCents: number | null;
  /** Amount saved by an active sale (0 when none). Regular total = totalCents + savingsCents. */
  savingsCents: number;
  /** True when a custom value was chosen — final price requires a quote. */
  requiresCustomQuote: boolean;
}
