"use server";

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";

export type CatalogItemKind = "optionGroup" | "optionValue" | "addOn";

/** What deleting an option group, option value or add-on would affect (shown before confirming). */
export type CatalogImpact = {
  found: boolean;
  name: string;
  /** Products that use it now (it's removed from them on delete). */
  products: Array<{ name: string; status: string }>;
  /** Configurable add-ons whose configuration uses it. */
  addOns: string[];
  /** Option groups: values deleted with it. Add-ons: configuration groups detached (the groups stay in the library). */
  childCount: number;
  /** Conditional pricing rules removed with it (its own rules and rules that depend on it). */
  priceRules: number;
};

const none = (name = ""): CatalogImpact => ({ found: false, name, products: [], addOns: [], childCount: 0, priceRules: 0 });

/**
 * Live usage for the delete confirmation. Owners and admins only (the same
 * people who may delete). Saved quotes, orders and invoices aren't counted:
 * they keep their own snapshot and are never affected by a delete.
 */
export async function catalogDeletionImpact(kind: CatalogItemKind, id: string): Promise<CatalogImpact> {
  await requireAdmin();
  const productSelect = { product: { select: { name: true, status: true } } } as const;

  if (kind === "optionGroup") {
    const g = await prisma.optionGroup.findUnique({
      where: { id: String(id) },
      select: {
        name: true,
        products: { select: productSelect, orderBy: { product: { name: "asc" } } },
        addOns: { select: { addOn: { select: { name: true } } } },
        values: { select: { id: true } },
      },
    });
    if (!g) return none();
    const valueIds = g.values.map((v) => v.id);
    const priceRules = await prisma.optionValuePriceRule.count({ where: { OR: [{ optionValueId: { in: valueIds } }, { dependsOnValueId: { in: valueIds } }] } });
    return { found: true, name: g.name, products: g.products.map((p) => p.product), addOns: g.addOns.map((a) => a.addOn.name), childCount: valueIds.length, priceRules };
  }

  if (kind === "optionValue") {
    const v = await prisma.optionValue.findUnique({
      where: { id: String(id) },
      select: {
        id: true,
        displayName: true,
        group: {
          select: {
            name: true,
            // Products offering this value: the group is attached and the product hasn't switched the value off.
            products: { select: { ...productSelect, valueOverrides: { where: { optionValueId: String(id) }, select: { enabled: true } } }, orderBy: { product: { name: "asc" } } },
            addOns: { select: { addOn: { select: { name: true } } } },
          },
        },
      },
    });
    if (!v) return none();
    const priceRules = await prisma.optionValuePriceRule.count({ where: { OR: [{ optionValueId: v.id }, { dependsOnValueId: v.id }] } });
    return {
      found: true,
      name: `${v.displayName} (${v.group.name})`,
      products: v.group.products.filter((p) => p.valueOverrides[0]?.enabled !== false).map((p) => p.product),
      addOns: v.group.addOns.map((a) => a.addOn.name),
      childCount: 0,
      priceRules,
    };
  }

  const a = await prisma.addOn.findUnique({
    where: { id: String(id) },
    select: { name: true, products: { select: productSelect, orderBy: { product: { name: "asc" } } }, _count: { select: { optionGroups: true } } },
  });
  if (!a) return none();
  return { found: true, name: a.name, products: a.products.map((p) => p.product), addOns: [], childCount: a._count.optionGroups, priceRules: 0 };
}
