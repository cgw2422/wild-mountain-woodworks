import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { resolveConfigurableProduct } from "./resolve";
import { priceConfiguration } from "./engine";
import type { ConfigurableProduct, ConfigurationSelection } from "./types";

const mediaSelect = {
  select: { url: true, alt: true, width: true, height: true, focalX: true, focalY: true, blurDataUrl: true },
} as const;

/** Prisma include producing a `ProductConfigRecord` (see ./resolve.ts). */
export const configurableProductInclude = {
  optionGroups: {
    include: {
      optionGroup: { include: { values: { include: { image: mediaSelect } } } },
      valueOverrides: true,
    },
  },
  addOns: {
    include: {
      addOn: {
        include: {
          image: mediaSelect,
          optionGroups: { include: { optionGroup: { include: { values: { include: { image: mediaSelect } } } } } },
        },
      },
    },
  },
} satisfies Prisma.ProductInclude;

/**
 * Load a product's configuration from the database with all overrides
 * applied. `activeOnly` (default) refuses drafts/archived products — used
 * when pricing customer submissions.
 */
export async function loadConfigurableProduct(
  where: { id: string } | { slug: string },
  opts: { activeOnly?: boolean } = {},
): Promise<ConfigurableProduct | null> {
  const record = await prisma.product.findFirst({
    where: { ...where, ...(opts.activeOnly === false ? {} : { status: "ACTIVE" as const }) },
    include: configurableProductInclude,
  });
  return record ? resolveConfigurableProduct(record) : null;
}

/** Server-side authoritative pricing for a submitted selection. */
export async function priceSelectionForProduct(productId: string, selection: ConfigurationSelection) {
  const product = await loadConfigurableProduct({ id: productId });
  if (!product) return null;
  return { product, pricing: priceConfiguration(product, selection) };
}

/**
 * One add-on resolved exactly as product pages see it (active groups and
 * values, labels, required, "sets the price per unit"), for admin price
 * previews. Not tied to a product, so product price overrides don't apply.
 */
export async function loadAddOnPreview(addOnId: string) {
  const addOn = await prisma.addOn.findUnique({ where: { id: addOnId }, include: configurableProductInclude.addOns.include.addOn.include });
  if (!addOn) return null;
  const product = resolveConfigurableProduct({
    id: "preview",
    name: "preview",
    slug: "preview",
    sku: null,
    basePriceCents: 0,
    optionGroups: [],
    addOns: [{ enabled: true, priceOverrideCents: null, requiredOverride: null, minQuantityOverride: null, maxQuantityOverride: null, displayOrder: 0, addOn: { ...addOn, active: true, archivedAt: null } }],
  });
  return product.addOns[0] ?? null;
}
