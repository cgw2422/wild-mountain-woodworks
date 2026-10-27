"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { LINE_KINDS, LINE_KIND_LABELS, lineTotal, type LineKind } from "@/lib/sales/totals";
import { adminButton } from "@/components/admin/ui";
import type { ConfigurationSelection } from "@/lib/pricing/types";

export interface EditableLine {
  key: string;
  sourceId: string | null;
  kind: LineKind;
  description: string;
  notes: string;
  quantity: string;
  price: string;
  taxable: boolean;
  productId: string | null;
  /** Read-only summary of a configured add-on carried by this line (e.g. "Add-on of Ridge Table — Style: X Back · Wood: Oak"). */
  addOnSummary?: string | null;
  /**
   * A configured catalog product (quote editor): its choices and the lines it
   * produces (the piece, its sale discount, its add-ons). Those lines are
   * shown nested and priced by the shared engine; the server re-prices them.
   */
  config?: LineConfig | null;
  /** A plain product line that still carries an older configuration snapshot (can be turned into a configured line). */
  legacySelection?: ConfigurationSelection | null;
}

export interface LineConfig {
  productId: string;
  selection: ConfigurationSelection;
  overrideTotalCents: number | null;
  /** Per piece, from the pricing engine. */
  calculatedTotalCents: number | null;
  /** True once edited in this session — the server re-prices it on save. */
  changed: boolean;
  lines: Array<{ kind: LineKind; description: string; notes: string | null; quantity: number; unitPriceCents: number }>;
}

/** The priced lines a row contributes to the totals preview (a configured product expands to its lines). */
export function previewLines(l: EditableLine): Array<{ kind: LineKind; quantity: number; unitPriceCents: number }> {
  if (l.config) return l.config.lines.map((x) => ({ kind: x.kind, quantity: x.quantity, unitPriceCents: x.unitPriceCents }));
  return [{ kind: l.kind, quantity: lineQuantity(l) || 0, unitPriceCents: linePriceCents(l) || 0 }];
}

let counter = 0;
export const newLineKey = () => `new-${Date.now().toString(36)}-${counter++}`;

export function blankLine(kind: LineKind = "CUSTOM", overrides: Partial<EditableLine> = {}): EditableLine {
  return { key: newLineKey(), sourceId: null, kind, description: "", notes: "", quantity: "1", price: "", taxable: kind !== "DELIVERY" && kind !== "DISCOUNT", productId: null, ...overrides };
}

/** Cents for a line's price text; NaN when invalid. Discounts are stored negative. */
export function linePriceCents(l: EditableLine): number {
  const c = parseDollarsToCents(l.price.replace(/^-/, ""));
  if (c == null) return 0;
  return l.kind === "DISCOUNT" ? -Math.abs(c) : c;
}

export function lineQuantity(l: EditableLine): number {
  const n = Number(l.quantity);
  return Number.isInteger(n) && n >= 1 ? n : NaN;
}

export function lineIssues(lines: EditableLine[]): Record<string, string> {
  const issues: Record<string, string> = {};
  for (const l of lines) {
    if (!l.description.trim()) issues[l.key] = "Add a description.";
    else if (l.config) continue;
    else if (Number.isNaN(lineQuantity(l)) || lineQuantity(l) > 999) issues[l.key] = "Quantity must be a whole number from 1 to 999.";
    else if (Number.isNaN(linePriceCents(l))) issues[l.key] = "Enter a price like 1250 or 1,250.00.";
  }
  return issues;
}

/**
 * Editable, reorderable quote/invoice lines. Totals shown here are a
 * preview only — the server recomputes everything when saving.
 */
export function LineItemsEditor({
  lines,
  onChange,
  showTaxable,
  disabled,
  issues,
  onConfigure,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  showTaxable: boolean;
  disabled?: boolean;
  issues: Record<string, string>;
  /** Quote editor only: open the product configurator for a catalog product line. */
  onConfigure?: (line: EditableLine) => void;
}) {
  const update = (key: string, patch: Partial<EditableLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...lines];
    const [row] = next.splice(i, 1);
    next.splice(i + dir, 0, row!);
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {lines.length === 0 ? <p className="rounded border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">No lines yet. Add the piece, add-ons, delivery and any other charges below.</p> : null}
      {lines.map((l, i) => (
        <LineRow
          key={l.key}
          line={l}
          index={i}
          count={lines.length}
          showTaxable={showTaxable}
          disabled={disabled}
          issue={issues[l.key]}
          onPatch={(p) => update(l.key, p)}
          onMove={(dir) => move(i, dir)}
          onDuplicate={() => {
            const next = [...lines];
            // A duplicated configured product is priced afresh by the server as its own group.
            next.splice(i + 1, 0, { ...l, key: newLineKey(), sourceId: l.config ? null : l.sourceId, config: l.config ? { ...l.config, changed: true } : l.config });
            onChange(next);
          }}
          onConfigure={onConfigure && (l.config || l.productId) && !disabled ? () => onConfigure(l) : undefined}
          onRemove={() => onChange(lines.filter((x) => x.key !== l.key))}
        />
      ))}
    </div>
  );
}

function LineRow({
  line: l,
  index,
  count,
  showTaxable,
  disabled,
  issue,
  onPatch,
  onMove,
  onDuplicate,
  onRemove,
  onConfigure,
}: {
  line: EditableLine;
  index: number;
  count: number;
  showTaxable: boolean;
  disabled?: boolean;
  issue?: string;
  onPatch: (p: Partial<EditableLine>) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onConfigure?: () => void;
}) {
  const id = useId();
  if (l.config) return <ConfiguredRow line={l} index={index} count={count} disabled={disabled} issue={issue} onPatch={onPatch} onMove={onMove} onDuplicate={onDuplicate} onRemove={onRemove} onConfigure={onConfigure} />;
  const qty = lineQuantity(l);
  const unit = linePriceCents(l);
  const total = Number.isNaN(qty) || Number.isNaN(unit) ? null : lineTotal({ kind: l.kind, quantity: qty, unitPriceCents: unit });
  const input = "block w-full rounded border border-neutral-300 bg-white px-3 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 disabled:bg-neutral-50";
  return (
    <fieldset className={cn("rounded-md border bg-white p-3 sm:p-4", issue ? "border-red-400" : "border-neutral-200")} aria-describedby={issue ? `${id}-issue` : undefined}>
      <legend className="sr-only">Line {index + 1}</legend>
      <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
        <div>
          <label htmlFor={`${id}-kind`} className="mb-1 block text-xs font-medium text-neutral-600">
            Type
          </label>
          <select id={`${id}-kind`} value={l.kind} disabled={disabled} onChange={(e) => onPatch({ kind: e.target.value as LineKind })} className={cn(input, "h-10")}>
            {LINE_KINDS.map((k) => (
              <option key={k} value={k}>
                {LINE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-desc`} className="mb-1 block text-xs font-medium text-neutral-600">
            Description (shown to the customer)
          </label>
          <input id={`${id}-desc`} value={l.description} maxLength={500} disabled={disabled} onChange={(e) => onPatch({ description: e.target.value })} className={cn(input, "h-10")} />
        </div>
      </div>
      <div className="mt-3">
        <label htmlFor={`${id}-notes`} className="mb-1 block text-xs font-medium text-neutral-600">
          Details (shown to the customer)
        </label>
        <textarea id={`${id}-notes`} value={l.notes} rows={l.notes.split("\n").length > 2 ? 4 : 2} maxLength={2000} disabled={disabled} onChange={(e) => onPatch({ notes: e.target.value })} className={cn(input, "py-2")} />
      </div>
      <div className="mt-3 grid grid-cols-2 items-end gap-3 sm:grid-cols-[6rem_9rem_1fr_auto]">
        <div>
          <label htmlFor={`${id}-qty`} className="mb-1 block text-xs font-medium text-neutral-600">
            Qty
          </label>
          <input id={`${id}-qty`} inputMode="numeric" value={l.quantity} disabled={disabled} onChange={(e) => onPatch({ quantity: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })} className={cn(input, "h-10 tabular-nums")} />
        </div>
        <div>
          <label htmlFor={`${id}-price`} className="mb-1 block text-xs font-medium text-neutral-600">
            {l.kind === "DISCOUNT" ? "Discount each" : "Price each"}
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-neutral-500">{l.kind === "DISCOUNT" ? "−$" : "$"}</span>
            <input id={`${id}-price`} inputMode="decimal" value={l.price.replace(/^-/, "")} disabled={disabled} onChange={(e) => onPatch({ price: e.target.value })} className={cn(input, "h-10 tabular-nums", l.kind === "DISCOUNT" ? "pl-8" : "pl-7")} />
          </div>
        </div>
        <p className="col-span-2 text-sm sm:col-span-1 sm:pb-2 sm:text-right">
          <span className="text-neutral-500">Line total </span>
          <span className="font-semibold tabular-nums">{total == null ? "—" : total < 0 ? `−${formatCents(-total, { showZeroCents: true })}` : formatCents(total, { showZeroCents: true })}</span>
        </p>
        {!disabled ? (
          <div className="col-span-2 flex flex-wrap items-center justify-end gap-1 sm:col-span-1">
            <button type="button" className={cn(adminButton.ghost, "h-11 min-w-11 px-2")} onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move line ${index + 1} up`}>
              ▲
            </button>
            <button type="button" className={cn(adminButton.ghost, "h-11 min-w-11 px-2")} onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move line ${index + 1} down`}>
              ▼
            </button>
            <button type="button" className={cn(adminButton.ghost, "h-11 px-2")} onClick={onDuplicate}>
              Duplicate
            </button>
            <button type="button" className={cn(adminButton.ghost, "h-11 px-2 text-red-700")} onClick={onRemove}>
              Remove
            </button>
          </div>
        ) : null}
      </div>
      {showTaxable ? (
        <label className="mt-2 inline-flex min-h-11 items-center gap-2 text-xs text-neutral-600">
          <input type="checkbox" checked={l.taxable} disabled={disabled} onChange={(e) => onPatch({ taxable: e.target.checked })} /> Taxable
        </label>
      ) : null}
      {l.productId ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span>Linked to a catalog product{l.sourceId ? " (configuration snapshot kept)" : ""}.</span>
          {onConfigure ? (
            <button type="button" className={cn(adminButton.secondary, "h-9")} onClick={onConfigure}>
              Configure product
            </button>
          ) : null}
        </div>
      ) : null}
      {l.addOnSummary && l.sourceId ? (
        <p className="mt-1 text-xs text-neutral-600">
          <span className="font-medium">Configured add-on</span> — {l.addOnSummary}
          {l.kind === "ADDON" ? " (kept with this line)" : " (dropped unless the line stays an add-on)"}
        </p>
      ) : null}
      {issue ? (
        <p id={`${id}-issue`} className="mt-2 text-xs font-medium text-red-600">
          {issue}
        </p>
      ) : null}
    </fieldset>
  );
}

const money = (c: number) => (c < 0 ? `−${formatCents(-c, { showZeroCents: true })}` : formatCents(c, { showZeroCents: true }));

/**
 * A configured catalog product: the piece with its choices, and the lines it
 * produces (sale discount, add-ons) nested underneath. Prices come from the
 * shared engine; change them with "Edit configuration" (incl. an override).
 */
function ConfiguredRow({
  line: l,
  index,
  count,
  disabled,
  issue,
  onPatch,
  onMove,
  onDuplicate,
  onRemove,
  onConfigure,
}: {
  line: EditableLine;
  index: number;
  count: number;
  disabled?: boolean;
  issue?: string;
  onPatch: (p: Partial<EditableLine>) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onConfigure?: () => void;
}) {
  const id = useId();
  const c = l.config!;
  const [piece, ...rest] = c.lines;
  const total = c.lines.reduce((sum, x) => sum + lineTotal(x), 0);
  const choices = (piece?.notes ?? "").split("\n").filter(Boolean);
  const input = "block w-full rounded border border-neutral-300 bg-white px-3 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 disabled:bg-neutral-50";
  return (
    <fieldset className={cn("rounded-md border bg-white p-3 sm:p-4", issue ? "border-red-400" : "border-neutral-300")} aria-describedby={issue ? `${id}-issue` : undefined}>
      <legend className="sr-only">Line {index + 1} — configured product</legend>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-neutral-900 px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-white">Configured product</span>
        {c.overrideTotalCents != null ? <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Price override</span> : null}
        {c.changed ? <span className="text-xs text-neutral-500">Priced with today&apos;s catalog when you save</span> : null}
      </div>
      <div className="mt-3">
        <label htmlFor={`${id}-desc`} className="mb-1 block text-xs font-medium text-neutral-600">
          Description (shown to the customer)
        </label>
        <input id={`${id}-desc`} value={l.description} maxLength={500} disabled={disabled} onChange={(e) => onPatch({ description: e.target.value })} className={cn(input, "h-10")} />
      </div>
      {choices.length ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
          {choices.map((line, i) => {
            const at = line.indexOf(": ");
            return at > 0 ? (
              <div key={i} className="contents">
                <dt className="text-neutral-500">{line.slice(0, at)}</dt>
                <dd className="text-neutral-900">{line.slice(at + 2)}</dd>
              </div>
            ) : (
              <dd key={i} className="col-span-2 text-neutral-900">
                {line}
              </dd>
            );
          })}
        </dl>
      ) : null}
      <ul className="mt-3 space-y-1 border-t border-neutral-100 pt-2 text-sm">
        {piece ? (
          <li className="flex justify-between gap-3">
            <span className="text-neutral-700">
              {l.description || piece.description}
              {piece.quantity > 1 ? ` × ${piece.quantity}` : ""}
            </span>
            <span className="tabular-nums">{money(lineTotal(piece))}</span>
          </li>
        ) : null}
        {rest.map((x, i) => (
          <li key={i} className="flex justify-between gap-3 pl-4">
            <span className="min-w-0 text-neutral-600">
              {x.kind === "ADDON" ? "Add-on · " : ""}
              {x.description}
              {x.quantity > 1 ? ` × ${x.quantity}` : ""}
              {x.kind === "ADDON" && x.notes ? <span className="block text-xs text-neutral-500">{x.notes.split("\n").join(" · ")}</span> : null}
            </span>
            <span className={cn("shrink-0 tabular-nums", x.kind === "DISCOUNT" && "text-emerald-700")}>{money(lineTotal(x))}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="text-neutral-500">Configured total </span>
          <span className="font-semibold tabular-nums">{money(total)}</span>
          {c.overrideTotalCents != null && c.calculatedTotalCents != null ? (
            <span className="ml-2 text-xs text-neutral-500">(calculated {money(c.calculatedTotalCents)} each, quoted {money(c.overrideTotalCents)} each)</span>
          ) : null}
        </p>
        {!disabled ? (
          <div className="flex flex-wrap items-center justify-end gap-1">
            {onConfigure ? (
              <button type="button" className={cn(adminButton.secondary, "h-11")} onClick={onConfigure}>
                Edit configuration
              </button>
            ) : null}
            <button type="button" className={cn(adminButton.ghost, "h-11 min-w-11 px-2")} onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move line ${index + 1} up`}>
              ▲
            </button>
            <button type="button" className={cn(adminButton.ghost, "h-11 min-w-11 px-2")} onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move line ${index + 1} down`}>
              ▼
            </button>
            <button type="button" className={cn(adminButton.ghost, "h-11 px-2")} onClick={onDuplicate}>
              Duplicate
            </button>
            <button type="button" className={cn(adminButton.ghost, "h-11 px-2 text-red-700")} onClick={onRemove}>
              Remove
            </button>
          </div>
        ) : null}
      </div>
      {issue ? (
        <p id={`${id}-issue`} className="mt-2 text-xs font-medium text-red-600">
          {issue}
        </p>
      ) : null}
    </fieldset>
  );
}
