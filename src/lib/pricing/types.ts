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

export interface ConfigOptionValue {
  id: string; // OptionValue.id
  name: string;
  displayName: string;
  description: string | null;
  priceModifierCents: number;
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
}

export interface ConfigAddOn {
  id: string; // AddOn.id
  name: string;
  description: string | null;
  priceCents: number;
  required: boolean;
  minQuantity: number;
  maxQuantity: number;
  image: ConfigImage | null;
}

export interface ConfigurableProduct {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  /** The base price charged now — the sale price while a sale is active. */
  basePriceCents: number | null;
  /** Set while a sale is active: the regular base price, when the sale ends and its label. */
  sale: { regularBasePriceCents: number; endsAt: string | null; label: string | null } | null;
  optionGroups: ConfigOptionGroup[];
  addOns: ConfigAddOn[];
}

/** What the customer picked. Keys are OptionGroup / AddOn ids. */
export interface ConfigurationSelection {
  options: Record<string, string>;
  addOns: Record<string, number>;
  /** Free-text details for "custom" option values, keyed by OptionGroup id. */
  customDetails?: Record<string, string>;
}

export type PriceLineKind = "base" | "option" | "addon";

export interface PriceLine {
  kind: PriceLineKind;
  label: string;
  detail?: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
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
