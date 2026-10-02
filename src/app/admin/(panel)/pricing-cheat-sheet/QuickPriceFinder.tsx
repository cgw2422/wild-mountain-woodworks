"use client";

import { useId, useState } from "react";
import { formatCents } from "@/lib/money";
import type { CheatSheet } from "@/lib/pricing/cheat-sheet";

/**
 * Pick size, wood and base → the price, instantly. Reads the grid the server
 * computed with the product page's pricing engine (no pricing here).
 */
export function QuickPriceFinder({ sheet }: { sheet: Pick<CheatSheet, "rows" | "columns" | "buckets" | "cells" | "groupNames"> }) {
  const id = useId();
  const [row, setRow] = useState(sheet.rows[0]?.id ?? "");
  const [column, setColumn] = useState(sheet.columns[0]?.id ?? "");
  const [bucket, setBucket] = useState(sheet.buckets[0]?.key ?? "");
  const price = sheet.cells[row]?.[column]?.[bucket] ?? null;
  const select =
    "mt-1 block h-12 w-full rounded-md border border-neutral-300 bg-white px-3 text-base text-neutral-900 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900";
  const label = "block text-xs font-semibold uppercase tracking-wide text-neutral-500";
  const rowLabel = sheet.rows.find((r) => r.id === row)?.label;
  const colLabel = sheet.columns.find((c) => c.id === column)?.label;
  const bucketLabel = sheet.buckets.find((b) => b.key === bucket)?.label;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
      <div className="grid gap-3 sm:grid-cols-3">
        {sheet.groupNames.row ? (
          <label className={label} htmlFor={`${id}-row`}>
            {sheet.groupNames.row}
            <select id={`${id}-row`} className={select} value={row} onChange={(e) => setRow(e.target.value)}>
              {sheet.rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {sheet.groupNames.column ? (
          <label className={label} htmlFor={`${id}-col`}>
            {sheet.groupNames.column}
            <select id={`${id}-col`} className={select} value={column} onChange={(e) => setColumn(e.target.value)}>
              {sheet.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {sheet.groupNames.base ? (
          <label className={label} htmlFor={`${id}-base`}>
            {sheet.groupNames.base}
            <select id={`${id}-base`} className={select} value={bucket} onChange={(e) => setBucket(e.target.value)}>
              {sheet.buckets.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <output htmlFor={`${id}-row ${id}-col ${id}-base`} aria-live="polite" className="block rounded-lg bg-neutral-900 p-4 text-white">
        <span className="block text-xs text-neutral-300">{[rowLabel, colLabel, bucketLabel].filter(Boolean).join(" · ")}</span>
        {price ? (
          price.savingsCents > 0 ? (
            <span className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
              <span className="text-sm text-neutral-300">Regular price</span>
              <span className="text-right text-sm text-neutral-300 line-through">{formatCents(price.regularCents)}</span>
              <span className="text-base font-semibold">Sale price</span>
              <span className="text-right text-2xl font-semibold">{formatCents(price.totalCents)}</span>
              <span className="text-sm text-emerald-300">Savings</span>
              <span className="text-right text-sm text-emerald-300">{formatCents(price.savingsCents)}</span>
            </span>
          ) : (
            <span className="mt-1 flex items-baseline justify-between tabular-nums">
              <span className="text-sm text-neutral-300">Regular price</span>
              <span className="text-2xl font-semibold">{formatCents(price.totalCents)}</span>
            </span>
          )
        ) : (
          <span className="mt-1 block text-sm text-neutral-300">This combination isn&apos;t available.</span>
        )}
      </output>
    </div>
  );
}
