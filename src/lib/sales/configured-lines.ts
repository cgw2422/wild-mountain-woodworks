import { addOnChoicesText, addOnLineDetails, buildConfigurationSnapshot, snapshotOptionTotal, type AddOnLineDetails, type ConfigurationSnapshot } from "@/lib/pricing/snapshot";
import { priceConfiguration } from "@/lib/pricing/engine";
import type { ConfigurableProduct, ConfigurationSelection } from "@/lib/pricing/types";
import { lineTotal, type LineKind } from "./totals";

/*
 * Quote lines from a product configuration — shared by the server (saving a
 * quote, website requests) and the admin quote editor's live preview, so
 * both always produce the same lines and totals. Client-safe (no database).
 */

export interface DraftLine {
  kind: LineKind;
  description: string;
  notes: string | null;
  quantity: number;
  unitPriceCents: number;
  taxable: boolean;
  productId: string | null;
  configuration: ConfigurationSnapshot | null;
  /** A configured add-on of the product line above it (e.g. Dining Chairs with their choices). */
  addOn?: AddOnLineDetails | null;
  /** Lines generated from one configured product share this id (see QuoteLineItem.configGroup). */
  configGroup?: string | null;
}

/**
 * The starting lines for a configured request: the piece at its REGULAR
 * price (base + ordinary options), a separate sale discount line when a sale
 * applied, one line per quantity-based option (e.g. "Dining Chairs — Cross
 * Back Chair", 4 × $192.50) and one per add-on. Their total equals the
 * snapshot's total.
 */
export function linesFromSnapshot(s: ConfigurationSnapshot, quantity = 1, configGroup: string | null = null): DraftLine[] {
  const qty = Math.max(1, Math.trunc(quantity));
  const perPiece = s.options.filter((o) => o.quantity == null);
  const counted = s.options.filter((o) => o.quantity != null && o.quantity > 0);
  const optionsCents = perPiece.reduce((sum, o) => sum + snapshotOptionTotal(o), 0);
  const regularBase = s.sale?.regularBasePriceCents ?? s.basePriceCents ?? 0;
  const notes = perPiece.map((o) => `${o.groupDisplayName}: ${o.valueDisplayName}${o.customDetails ? ` (${o.customDetails})` : ""}`).join("\n");
  const lines: DraftLine[] = [
    {
      kind: "PRODUCT",
      description: s.product.name,
      notes: notes || null,
      quantity: qty,
      unitPriceCents: s.basePriceCents == null ? 0 : regularBase + optionsCents,
      taxable: true,
      productId: s.product.id,
      configuration: s,
    },
  ];
  if (s.sale && s.sale.savingsCents > 0) {
    const pct = s.sale.percent != null ? ` (${s.sale.percent}% off)` : "";
    lines.push({ kind: "DISCOUNT", description: `${s.sale.label || "Sale"}${pct} — ${s.product.name}`, notes: null, quantity: qty, unitPriceCents: -s.sale.savingsCents, taxable: true, productId: null, configuration: null });
  }
  for (const o of counted) {
    lines.push({
      kind: "ADDON",
      description: `${o.groupDisplayName} — ${o.valueDisplayName}`,
      notes: o.customDetails,
      quantity: o.quantity! * qty,
      unitPriceCents: o.unitPriceCents ?? o.priceModifierCents,
      taxable: true,
      productId: null,
      configuration: null,
    });
  }
  for (const a of s.addOns) {
    // Configured add-ons keep every choice (style, wood, finishes…) on their own line, grouped under the piece.
    const details = addOnLineDetails(s, a);
    lines.push({
      kind: "ADDON",
      description: a.name,
      notes: details ? addOnChoicesText(details.choices) : null,
      quantity: a.quantity * qty,
      unitPriceCents: a.unitPriceCents,
      taxable: true,
      productId: null,
      configuration: null,
      addOn: details,
    });
  }
  return configGroup ? lines.map((l) => ({ ...l, configGroup })) : lines;
}

export type ConfiguredLinesResult =
  | {
      ok: true;
      lines: DraftLine[];
      snapshot: ConfigurationSnapshot;
      /** Per piece, from the pricing engine (the product page's price). */
      calculatedTotalCents: number | null;
      /** Per piece, what the quote charges (the override when set). */
      quotedTotalCents: number | null;
    }
  | { ok: false; errors: Record<string, string>; message: string };

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Price a configured catalog product for a quote with the SAME engine as the
 * product page (priceConfiguration: options, conditional prices, add-ons,
 * the active sale on the core price only) and turn it into quote lines:
 * the piece with every choice listed, its sale discount, and one line per
 * add-on — all sharing `configGroup`.
 *
 * `overrideTotalCents` (per piece) replaces the calculated price on the
 * quote: the add-on lines keep their prices, the piece line takes the rest,
 * and the sale line is dropped (the override is the final price). The
 * calculated price is kept on the snapshot (quotePricing) for reference.
 */
export function configuredProductLines(
  product: ConfigurableProduct,
  selection: ConfigurationSelection,
  opts: { quantity: number; overrideTotalCents?: number | null; configGroup: string; now?: Date },
): ConfiguredLinesResult {
  const pricing = priceConfiguration(product, selection);
  if (!pricing.valid) {
    const message = Object.values(pricing.errors)[0] ?? "Please complete the configuration.";
    return { ok: false, errors: pricing.errors, message };
  }
  const qty = Math.max(1, Math.trunc(opts.quantity) || 1);
  const override = opts.overrideTotalCents ?? null;
  const snapshot: ConfigurationSnapshot = {
    ...buildConfigurationSnapshot(product, selection, pricing, { priceShownToCustomer: true, now: opts.now }),
    quotePricing: { calculatedTotalCents: pricing.totalCents, overrideTotalCents: override },
  };
  let lines = linesFromSnapshot(snapshot, qty, opts.configGroup);
  if (override != null) {
    const addOnsPerPiece = lines.filter((l) => l.kind === "ADDON").reduce((sum, l) => sum + lineTotal(l), 0) / qty;
    const pieceCents = override - addOnsPerPiece;
    if (pieceCents < 0) {
      const message = `The override can't be less than this piece's add-ons (${usd(addOnsPerPiece)}).`;
      return { ok: false, errors: { _override: message }, message };
    }
    lines = lines.filter((l) => l.kind !== "DISCOUNT").map((l) => (l.kind === "PRODUCT" ? { ...l, unitPriceCents: pieceCents } : l));
  }
  return { ok: true, lines, snapshot, calculatedTotalCents: pricing.totalCents, quotedTotalCents: override ?? pricing.totalCents };
}
