import { activeSale } from "./sale";
import type { ConfigImage, ConfigurableProduct, OptionInputType } from "./types";

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
      const maxQuantity = Math.max(1, pa.maxQuantityOverride ?? a.maxQuantity);
      const minQuantity = Math.min(maxQuantity, Math.max(0, pa.minQuantityOverride ?? a.minQuantity));
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        priceCents: pa.priceOverrideCents ?? a.priceCents,
        required: pa.requiredOverride ?? a.required,
        minQuantity,
        maxQuantity,
        image: toImage(a.image, a.name),
      };
    });

  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    sku: record.sku,
    basePriceCents: sale ? sale.priceCents : record.basePriceCents,
    sale: sale ? { regularBasePriceCents: sale.regularPriceCents, endsAt: sale.endsAt, label: sale.label } : null,
    optionGroups,
    addOns,
  };
}
