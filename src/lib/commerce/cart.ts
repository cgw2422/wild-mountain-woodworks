import "server-only";
import { loadConfigurableProduct } from "@/lib/pricing/load";
import { priceConfiguration } from "@/lib/pricing/engine";
import { buildConfigurationSnapshot, type ConfigurationSnapshot } from "@/lib/pricing/snapshot";
import type { ConfigurationSelection } from "@/lib/pricing/types";

/**
 * Future cart model. A cart line only ever carries WHAT the customer chose
 * (product + selection + quantity) — never a price. Prices are recalculated
 * here from the database every time the cart is displayed or checked out.
 */
export interface CartLine {
  productId: string;
  selection: ConfigurationSelection;
  quantity: number;
}

export interface PricedCartLine {
  line: CartLine;
  snapshot: ConfigurationSnapshot;
  unitPriceCents: number;
  lineTotalCents: number;
}

export class CartError extends Error {}

export async function priceCart(lines: CartLine[]): Promise<{ lines: PricedCartLine[]; subtotalCents: number }> {
  if (lines.length === 0) throw new CartError("Your cart is empty.");
  const priced: PricedCartLine[] = [];
  for (const line of lines) {
    const quantity = Math.trunc(line.quantity);
    if (quantity < 1 || quantity > 20) throw new CartError("Invalid quantity.");
    const product = await loadConfigurableProduct({ id: line.productId });
    if (!product) throw new CartError("A piece in your cart is no longer available.");
    const pricing = priceConfiguration(product, line.selection);
    if (!pricing.valid) throw new CartError(`Please review the configuration for ${product.name}.`);
    if (pricing.totalCents == null || pricing.requiresCustomQuote) {
      throw new CartError(`${product.name} requires a custom quote and can't be purchased online.`);
    }
    const snapshot = buildConfigurationSnapshot(product, line.selection, pricing, { priceShownToCustomer: true });
    priced.push({ line: { ...line, quantity }, snapshot, unitPriceCents: pricing.totalCents, lineTotalCents: pricing.totalCents * quantity });
  }
  return { lines: priced, subtotalCents: priced.reduce((s, l) => s + l.lineTotalCents, 0) };
}
