"use client";

import { useState } from "react";
import { MoneyInput, TextInput, Toggle } from "@/components/admin/forms";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { formatPercent, parseSaleAmount, percentOff, saleCaption } from "@/lib/pricing/sale";

/**
 * Regular price + Sale section of the product editor, with a live preview.
 * The preview is a convenience only: the server re-validates everything on
 * save (products/_lib/sale.ts) and decides whether a sale is active.
 */
export function SaleFields({
  initial,
  today,
  timeZoneLabel,
  showPriceToggle,
}: {
  initial: { basePrice: string; saleEnabled: boolean; salePrice: string; saleStarts: string; saleEnds: string; saleLabel: string };
  /** Today's date ("YYYY-MM-DD") in the site time zone. */
  today: string;
  timeZoneLabel: string;
  showPriceToggle: React.ReactNode;
}) {
  const [basePrice, setBasePrice] = useState(initial.basePrice);
  const [enabled, setEnabled] = useState(initial.saleEnabled);
  const [salePrice, setSalePrice] = useState(initial.salePrice);
  const [starts, setStarts] = useState(initial.saleStarts);
  const [ends, setEnds] = useState(initial.saleEnds);
  const [label, setLabel] = useState(initial.saleLabel);

  const regular = parseDollarsToCents(basePrice);
  const regularCents = regular == null || Number.isNaN(regular) || regular <= 0 ? null : regular;
  const amount = parseSaleAmount(salePrice, regularCents);
  const valid = amount && !("error" in amount) ? amount : null;
  const saleCents = valid?.cents ?? null;
  const error = amount && "error" in amount ? amount.error : enabled && !salePrice.trim() ? "Enter a sale price, or switch the sale off." : null;
  const datesBackwards = Boolean(starts && ends && ends < starts);

  let status: { tone: "live" | "wait" | "off"; text: string };
  if (!enabled) status = { tone: "off", text: "Sale is off — customers see the regular price." };
  else if (error || saleCents == null) status = { tone: "off", text: "Fix the sale price to save." };
  else if (datesBackwards) status = { tone: "off", text: "The end date is before the start date." };
  else if (starts && starts > today) status = { tone: "wait", text: `Scheduled — starts ${fmtDay(starts)}${ends ? `, ends after ${fmtDay(ends)}` : ""}.` };
  else if (ends && ends < today) status = { tone: "off", text: `Ended ${fmtDay(ends)} — customers see the regular price.` };
  else status = { tone: "live", text: ends ? `On sale now, through ${fmtDay(ends)}.` : "On sale now, until you switch it off." };

  // Percent sales advertise the entered percentage; fixed prices derive it (rounded down).
  const pct = valid?.kind === "PERCENT" ? valid.percent : regularCents != null && saleCents != null ? percentOff(regularCents, saleCents) : 0;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyInput
          label="Regular price"
          name="basePrice"
          value={basePrice}
          onChange={(e) => setBasePrice(e.target.value)}
          placeholder="e.g. 1399"
          help="The base price before options and add-ons. Leave blank for “Price on request”."
        />
        <div className="sm:pt-7">{showPriceToggle}</div>
      </div>

      <div id="sale" className="mt-5 scroll-mt-6 rounded-md border border-neutral-200 p-4">
        <Toggle
          label="Sale enabled"
          name="saleEnabled"
          checked={enabled}
          onChange={setEnabled}
          description="While on (and within the dates below), the sale price replaces the regular price. Options and add-ons keep their prices."
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextInput
            label="Sale price"
            name="salePrice"
            inputMode="decimal"
            value={salePrice}
            onChange={(e) => setSalePrice(e.target.value)}
            placeholder="e.g. 979 or 30%"
            help="A fixed price like 979, or a percent off like 30% (price rounded to the dollar; 30% is what customers see)."
          />
          <TextInput
            label="Sale label"
            name="saleLabel"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            placeholder="Sale"
            help="Optional, e.g. “Fall Sale”. Blank shows “Sale”."
          />
          <TextInput label="Sale start" name="saleStarts" type="date" value={starts} onChange={(e) => setStarts(e.target.value)} help="Optional. Blank = starts right away." />
          <TextInput
            label="Sale end"
            name="saleEnds"
            type="date"
            value={ends}
            onChange={(e) => setEnds(e.target.value)}
            help={`Optional. The last day of the sale (${timeZoneLabel} time). Blank = until switched off.`}
          />
        </div>

        <div className="mt-4 rounded-md bg-neutral-50 p-4" aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Preview</p>
          {error && (enabled || salePrice.trim()) ? (
            <p className="mt-2 text-sm text-red-700">{error}</p>
          ) : regularCents != null && saleCents != null ? (
            <>
              <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <PreviewStat term="Regular" value={formatCents(regularCents)} />
                <PreviewStat term="Sale" value={formatCents(saleCents)} />
                <PreviewStat term="Savings" value={formatCents(regularCents - saleCents)} />
                <PreviewStat term="Discount" value={`${formatPercent(pct)}%`} />
              </dl>
              <p className="mt-2 text-xs text-neutral-500">
                {valid?.kind === "PERCENT"
                  ? `Percent sale: ${formatPercent(valid.percent)}% off ${formatCents(regularCents)} = ${Number.isInteger(valid.exactCents) ? "" : "about "}${formatCents(Math.round(valid.exactCents), { showZeroCents: true })}${valid.exactCents !== valid.cents ? `, rounded to ${formatCents(valid.cents)}` : ""}. Advertised as ${formatPercent(valid.percent)}% off, and follows the regular price if it changes.`
                  : "Fixed sale price: the discount shown is calculated from the two prices."}
              </p>
              <p className="mt-3 border-t border-neutral-200 pt-3 text-base">
                <span className="text-muted">From </span>
                <del className="text-muted decoration-1">{formatCents(regularCents)}</del>{" "}
                <span className="font-semibold text-bronze-text">{formatCents(saleCents)}</span>
                <span className="ml-2 text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-bronze-text">{saleCaption(label, pct)}</span>
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-neutral-500">Enter a regular price and a sale price to preview the sale.</p>
          )}
          <p className={`mt-2 text-sm ${status.tone === "live" ? "font-medium text-bronze-text" : status.tone === "wait" ? "text-amber-800" : "text-neutral-600"}`}>{status.text}</p>
        </div>
      </div>
    </>
  );
}

function PreviewStat({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{term}</dt>
      <dd className="font-medium tabular-nums text-neutral-900">{value}</dd>
    </div>
  );
}

function fmtDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
