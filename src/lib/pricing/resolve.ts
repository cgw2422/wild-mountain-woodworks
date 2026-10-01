import { activeSale } from "./sale";
import type { ConfigImage, ConfigOptionGroup, ConfigOptionValue, ConfigurableProduct, OptionInputType, OptionQuantitySpec } from "./types";

/**
 * Structural shapes of the database records needed to build a configurable
 * product (matches `configurableProductInclude` in ./load.ts). Kept structural
 * so this module stays pure and unit-testable without a database.
 */
export interface MediaLike {
  url: string;
  alt: string;
  width: number;
  height: number;
  focalX: number;
  focalY: number;
  blurDataUrl: string | null;
}

export interface ProductConfigRecord {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  basePriceCents: number | null;
  saleEnabled?: boolean;
  saleType?: "PERCENT" | "FIXED_PRICE" | null;
  salePercentBps?: number | null;
  salePriceCents?: number | null;
  saleStartsAt?: Date | null;
  saleEndsAt?: Date | null;
  saleLabel?: string | null;
  optionGroups: Array<{
    displayOrder: number;
    requiredOverride: boolean | null;
    displayNameOverride: string | null;
    optionGroup: {
      id: string;
      name: string;
      displayName: string;
      description: string | null;
      inputType: OptionInputType;
      required: boolean;
      active: boolean;
      values: Array<{
        id: string;
        name: string;
        displayName: string;
        description: string | null;
        priceModifierCents: number;
        isCustom: boolean;
        quantityEnabled?: boolean;
        quantityMin?: number;
        quantityMax?: number;
        quantityStep?: number;
        quantityDefault?: number;
        displayOrder: number;
        active: boolean;
        swatchColor: string | null;
        image: MediaLike | null;
      }>;
    };
    valueOverrides: Array<{
      optionValueId: string;
      enabled: boolean;
      priceModifierOverrideCents: number | null;
      displayOrderOverride: number | null;
      isDefault: boolean;
    }>;
  }>;
  addOns: Array<{
    enabled: boolean;
    priceOverrideCents: number | null;
    requiredOverride: boolean | null;
    minQuantityOverride: number | null;
    maxQuantityOverride: number | null;
    displayOrder: number;
    addOn: {
      id: string;
      name: string;
      description: string | null;
      priceCents: number;
      required: boolean;
      minQuantity: number;
      maxQuantity: number;
      active: boolean;
      archivedAt: Date | null;
      image: MediaLike | null;
      displayName?: string | null;
      quantityEnabled?: boolean;
      quantityStep?: number;
      defaultQuantity?: number | null;
      /** Configurable add-ons: the add-on's own option groups (absent/empty for simple add-ons). */
      optionGroups?: Array<{
        displayOrder: number;
        requiredOverride: boolean | null;
        displayNameOverride: string | null;
        setsUnitPrice?: boolean;
        optionGroup: ProductConfigRecord["optionGroups"][number]["optionGroup"];
      }>;
    };
  }>;
}

function toImage(m: MediaLike | null, fallbackAlt: string): ConfigImage | null {
  if (!m) return null;
  return {
    url: m.url,
    alt: m.alt || fallbackAlt,
    width: m.width,
    height: m.height,
    focalX: m.focalX,
    focalY: m.focalY,
    blurDataUrl: m.blurDataUrl,
  };
}

/** A sane quantity range for a quantity-based value (null for ordinary values). */
export function quantitySpec(v: { quantityEnabled?: boolean; quantityMin?: number; quantityMax?: number; quantityStep?: number; quantityDefault?: number }): OptionQuantitySpec | null {
  if (!v.quantityEnabled) return null;
  const min = Math.max(0, Math.trunc(v.quantityMin ?? 0));
  const max = Math.max(min, Math.trunc(v.quantityMax ?? min));
  const step = Math.max(1, Math.trunc(v.quantityStep ?? 1));
  const raw = Math.min(max, Math.max(min, Math.trunc(v.quantityDefault ?? min)));
  // Snap the default onto the step grid (counting from the minimum).
  const def = min + Math.floor((raw - min) / step) * step;
  return { min, max, step, default: def };
}

/**
 * An add-on's own option groups (e.g. Chair Style, Wood Species, Chair
 * Finish, Seat Finish): active groups and values from the shared library, in
 * order. Their adjustments are per add-on unit. "Custom" values and
 * per-value quantities don't apply inside an add-on (the add-on has its own
 * quantity), so they're left out / ignored here.
 */
function resolveAddOnGroups(groups: NonNullable<ProductConfigRecord["addOns"][number]["addOn"]["optionGroups"]>): ConfigOptionGroup[] {
  return [...groups]
    .filter((ag) => ag.optionGroup.active)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((ag) => {
      const g = ag.optionGroup;
      const values: ConfigOptionValue[] = g.values
        .filter((v) => v.active && !v.isCustom)
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((v) => ({
          id: v.id,
          name: v.name,
          displayName: v.displayName,
          description: v.description,
          priceModifierCents: v.priceModifierCents,
          quantity: null,
          isCustom: false,
          isDefault: false,
          swatchColor: v.swatchColor,
          image: toImage(v.image, v.displayName),
        }));
      return {
        id: g.id,
        name: g.name,
        displayName: ag.displayNameOverride?.trim() || g.displayName,
        description: g.description,
        inputType: g.inputType,
        required: ag.requiredOverride ?? g.required,
        values,
        setsUnitPrice: Boolean(ag.setsUnitPrice),
      };
    })
    .filter((g) => g.values.length > 0);
}

/**
 * Apply per-product overrides to the global option library:
 * - inactive global groups/values are hidden
 * - a product can disable individual values, override their price, order and
 *   default; values without an override row inherit global settings
 * - add-ons can be disabled or have price/required/quantity overridden
 */
export function resolveConfigurableProduct(record: ProductConfigRecord, now: Date = new Date()): ConfigurableProduct {
  const sale = activeSale(record, now);
  const optionGroups = [...record.optionGroups]
    .filter((pog) => pog.optionGroup.active)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((pog) => {
      const g = pog.optionGroup;
      const overrides = new Map(pog.valueOverrides.map((o) => [o.optionValueId, o]));
      const values = g.values
        .filter((v) => v.active && (overrides.get(v.id)?.enabled ?? true))
        .map((v) => {
          const o = overrides.get(v.id);
          return {
            order: o?.displayOrderOverride ?? v.displayOrder,
            value: {
              id: v.id,
              name: v.name,
              displayName: v.displayName,
              description: v.description,
              priceModifierCents: o?.priceModifierOverrideCents ?? v.priceModifierCents,
              quantity: quantitySpec(v),
              isCustom: v.isCustom,
              isDefault: o?.isDefault ?? false,
              swatchColor: v.swatchColor,
              image: toImage(v.image, v.displayName),
            },
          };
        })
        .sort((a, b) => a.order - b.order)
        .map((x) => x.value);
      return {
        id: g.id,
        name: g.name,
        displayName: pog.displayNameOverride?.trim() || g.displayName,
        description: g.description,
        inputType: g.inputType,
        required: pog.requiredOverride ?? g.required,
        values,
      };
    })
    // A group with no available values cannot be configured — hide it.
    .filter((g) => g.values.length > 0);

  const addOns = [...record.addOns]
    .filter((pa) => pa.enabled && pa.addOn.active && !pa.addOn.archivedAt)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((pa) => {
      const a = pa.addOn;
      const quantityEnabled = a.quantityEnabled ?? true;
      const required = pa.requiredOverride ?? a.required;
      // A yes/no add-on (quantity off) is always exactly 1 when added.
      const maxQuantity = quantityEnabled ? Math.max(1, pa.maxQuantityOverride ?? a.maxQuantity) : 1;
      const minQuantity = quantityEnabled ? Math.min(maxQuantity, Math.max(0, pa.minQuantityOverride ?? a.minQuantity)) : required ? 1 : 0;
      const step = quantityEnabled ? Math.max(1, Math.trunc(a.quantityStep ?? 1)) : 1;
      const lowest = Math.max(1, minQuantity);
      const rawDefault = Math.min(maxQuantity, Math.max(lowest, Math.trunc(a.defaultQuantity ?? lowest)));
      const name = a.displayName?.trim() || a.name;
      return {
        id: a.id,
        name,
        description: a.description,
        priceCents: pa.priceOverrideCents ?? a.priceCents,
        required,
        minQuantity,
        maxQuantity,
        quantityStep: step,
        // Snap onto the step grid (counting from the minimum) without going below 1.
        defaultQuantity: Math.max(lowest, minQuantity + Math.floor((rawDefault - minQuantity) / step) * step),
        quantityEnabled,
        image: toImage(a.image, name),
        optionGroups: resolveAddOnGroups(a.optionGroups ?? []),
      };
    });

  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    sku: record.sku,
    basePriceCents: sale ? sale.priceCents : record.basePriceCents,
    sale: sale ? { regularBasePriceCents: sale.regularPriceCents, endsAt: sale.endsAt, label: sale.label, percent: sale.percent } : null,
    optionGroups,
    addOns,
  };
}
