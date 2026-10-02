import { defaultSelection, priceConfiguration } from "./engine";
import type { ConfigOptionGroup, ConfigurableProduct, ConfigurationSelection } from "./types";

/**
 * Pricing Cheat Sheet (Admin → Pricing Cheat Sheet): a read-only price grid
 * for one product — rows (e.g. table size) × columns (e.g. wood species) ×
 * base choices (e.g. painted vs. match tabletop).
 *
 * Nothing here is a price formula: every number is priceConfiguration() run
 * on a real selection of the CURRENT product (active values only, per-product
 * overrides, conditional option prices, and the active sale on the core
 * price only) — exactly what the product page charges. Nothing is stored.
 */

export type CheatAxes = { rowGroupId: string | null; columnGroupId: string | null; baseGroupId: string | null };

export type CheatPrice = {
  /** What the customer pays now (the sale total while a sale is active). */
  totalCents: number;
  /** Without the sale (equal to totalCents when there's no sale). */
  regularCents: number;
  savingsCents: number;
};

/** Base values that cost the same in every cell are shown together ("Painted White / Painted Black"). */
export type CheatBucket = { key: string; label: string; valueIds: string[] };

export interface CheatSheet {
  axes: CheatAxes;
  rows: Array<{ id: string; label: string }>;
  columns: Array<{ id: string; label: string }>;
  buckets: CheatBucket[];
  /** cells[rowId][columnId][bucketKey]; null when that combination can't be ordered. */
  cells: Record<string, Record<string, Record<string, CheatPrice | null>>>;
  /** Other required options, held at their default choice for every price. */
  fixed: Array<{ group: string; value: string }>;
  groupNames: { row: string | null; column: string | null; base: string | null };
  sale: ConfigurableProduct["sale"];
}

const SINGLE = "_";

/** Values a customer can pick from a list (custom "describe it" values are quoted separately). */
const listed = (g: ConfigOptionGroup | undefined) => (g ? g.values.filter((v) => !v.isCustom) : []);

/** Best guess at which option is the size, the wood and the base — by name, never hard-coded ids or values. */
export function guessAxes(product: ConfigurableProduct): CheatAxes {
  const groups = product.optionGroups.filter((g) => listed(g).length);
  const taken = new Set<string>();
  // Keywords in order of preference: "Base Material / Finish" beats a generic "Finishes" group.
  const pick = (...patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const g = groups.find((x) => !taken.has(x.id) && (pattern.test(x.name) || pattern.test(x.displayName)));
      if (g) {
        taken.add(g.id);
        return g.id;
      }
    }
    return null;
  };
  const row = pick(/size/i, /length/i, /dimension/i);
  const column = pick(/species/i, /wood/i, /top/i);
  const base = pick(/base/i, /leg/i);
  const next = () => {
    const g = groups.find((x) => !taken.has(x.id));
    if (g) taken.add(g.id);
    return g?.id ?? null;
  };
  return { rowGroupId: row ?? next(), columnGroupId: column ?? next(), baseGroupId: base };
}

/** Requested axes (e.g. from the URL), validated against the product; missing/invalid ones fall back to the guess. */
export function resolveAxes(product: ConfigurableProduct, requested: Partial<Record<keyof CheatAxes, string | null | undefined>>): CheatAxes {
  const ok = new Set(product.optionGroups.filter((g) => listed(g).length).map((g) => g.id));
  const guess = guessAxes(product);
  const pick = (key: keyof CheatAxes) => {
    const r = requested[key];
    if (r === "none") return null;
    return r && ok.has(r) ? r : guess[key];
  };
  const axes: CheatAxes = { rowGroupId: pick("rowGroupId"), columnGroupId: pick("columnGroupId"), baseGroupId: pick("baseGroupId") };
  // One option per axis.
  if (axes.columnGroupId && axes.columnGroupId === axes.rowGroupId) axes.columnGroupId = null;
  if (axes.baseGroupId && (axes.baseGroupId === axes.rowGroupId || axes.baseGroupId === axes.columnGroupId)) axes.baseGroupId = null;
  return axes;
}

/** Price one choice of row/column/base with every other option at its default — via the product page's engine. */
export function priceCombination(product: ConfigurableProduct, axes: CheatAxes, picks: { row?: string; column?: string; base?: string }): CheatPrice | null {
  const selection: ConfigurationSelection = defaultSelection(product);
  const options = { ...selection.options };
  if (axes.rowGroupId && picks.row) options[axes.rowGroupId] = picks.row;
  if (axes.columnGroupId && picks.column) options[axes.columnGroupId] = picks.column;
  if (axes.baseGroupId && picks.base) options[axes.baseGroupId] = picks.base;
  const r = priceConfiguration(product, { ...selection, options });
  if (!r.valid || r.totalCents == null) return null;
  return { totalCents: r.totalCents, regularCents: r.totalCents + r.savingsCents, savingsCents: r.savingsCents };
}

export function buildCheatSheet(product: ConfigurableProduct, axes: CheatAxes): CheatSheet {
  const group = (id: string | null) => (id ? product.optionGroups.find((g) => g.id === id) : undefined);
  const rowGroup = group(axes.rowGroupId);
  const columnGroup = group(axes.columnGroupId);
  const baseGroup = group(axes.baseGroupId);
  const rows = rowGroup ? listed(rowGroup).map((v) => ({ id: v.id, label: v.displayName })) : [{ id: SINGLE, label: product.name }];
  const columns = columnGroup ? listed(columnGroup).map((v) => ({ id: v.id, label: v.displayName })) : [{ id: SINGLE, label: "Price" }];
  const baseValues = baseGroup ? listed(baseGroup) : [];
  const pick = (id: string) => (id === SINGLE ? undefined : id);

  // Price every base value in every cell.
  const perValue = new Map<string, Array<CheatPrice | null>>();
  const priceOf = (row: string, column: string, base?: string) => priceCombination(product, axes, { row: pick(row), column: pick(column), base });
  for (const v of baseValues) perValue.set(v.id, rows.flatMap((r) => columns.map((c) => priceOf(r.id, c.id, v.id))));

  // Group base values whose prices are identical everywhere (e.g. Painted White / Painted Black).
  const buckets: CheatBucket[] = [];
  const signature = (prices: Array<CheatPrice | null>) => prices.map((p) => (p ? `${p.totalCents}/${p.regularCents}` : "-")).join(",");
  const bySignature = new Map<string, CheatBucket>();
  for (const v of baseValues) {
    const sig = signature(perValue.get(v.id)!);
    const existing = bySignature.get(sig);
    if (existing) {
      existing.valueIds.push(v.id);
      existing.label = `${existing.label} / ${v.displayName}`;
    } else {
      const b = { key: v.id, label: v.displayName, valueIds: [v.id] };
      bySignature.set(sig, b);
      buckets.push(b);
    }
  }
  if (!baseValues.length) buckets.push({ key: SINGLE, label: "", valueIds: [] });

  const cells: CheatSheet["cells"] = {};
  rows.forEach((r, ri) => {
    cells[r.id] = {};
    columns.forEach((c, ci) => {
      cells[r.id]![c.id] = Object.fromEntries(
        buckets.map((b) => [b.key, b.valueIds.length ? perValue.get(b.valueIds[0]!)![ri * columns.length + ci]! : priceOf(r.id, c.id)]),
      );
    });
  });

  // Everything else stays at the product page's default choice.
  const defaults = defaultSelection(product);
  const axisIds = new Set([axes.rowGroupId, axes.columnGroupId, axes.baseGroupId]);
  const fixed = product.optionGroups
    .filter((g) => !axisIds.has(g.id) && defaults.options[g.id])
    .map((g) => ({ group: g.displayName, value: g.values.find((v) => v.id === defaults.options[g.id])?.displayName ?? "" }));

  return {
    axes,
    rows,
    columns,
    buckets,
    cells,
    fixed,
    groupNames: { row: rowGroup?.displayName ?? null, column: columnGroup?.displayName ?? null, base: baseGroup?.displayName ?? null },
    sale: product.sale,
  };
}
