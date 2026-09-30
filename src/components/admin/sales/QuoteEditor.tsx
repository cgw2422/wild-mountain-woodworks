"use client";

import { useMemo, useState } from "react";
import type { ActionResult } from "@/lib/admin/types";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { computeTotals, parsePercentToBps, type DepositType } from "@/lib/sales/totals";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { Card, adminButton } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { LineItemsEditor, blankLine, lineIssues, linePriceCents, lineQuantity, type EditableLine } from "./LineItemsEditor";

export interface QuoteEditorValues {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;
  customerNotes: string;
  terms: string;
  expiresOn: string;
  leadTime: string;
  estimatedCompletion: string;
  deliveryDetails: string;
  depositType: DepositType;
  depositPercent: string;
  depositAmount: string;
  tax: string;
  lines: EditableLine[];
}

const input = "block w-full rounded border border-neutral-300 bg-white px-3 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900";

function Labeled({ label, htmlFor, help, children, className }: { label: string; htmlFor: string; help?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-neutral-800">
        {label}
      </label>
      {children}
      {help ? <p className="mt-1 text-xs text-neutral-500">{help}</p> : null}
    </div>
  );
}

/**
 * The quote editor for the current DRAFT revision. Everything here is
 * customer-facing except where noted; internal notes live in the Notes panel.
 * Totals are previewed live and recomputed on the server when saved.
 */
export function QuoteEditor({
  action,
  initial,
  products,
  taxEnabled,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  initial: QuoteEditorValues;
  products: Array<{ id: string; name: string; basePriceCents: number | null }>;
  taxEnabled: boolean;
}) {
  const [v, setV] = useState(initial);
  const set = <K extends keyof QuoteEditorValues>(k: K, value: QuoteEditorValues[K]) => setV((s) => ({ ...s, [k]: value }));
  const [addProduct, setAddProduct] = useState("");
  const issues = lineIssues(v.lines);

  const preview = useMemo(() => {
    const lines = v.lines.map((l) => ({ kind: l.kind, quantity: lineQuantity(l) || 0, unitPriceCents: linePriceCents(l) || 0 }));
    const bps = parsePercentToBps(v.depositPercent);
    const amount = parseDollarsToCents(v.depositAmount);
    const tax = taxEnabled ? parseDollarsToCents(v.tax) : 0;
    return computeTotals(lines, { depositType: v.depositType, depositPercentBps: Number.isFinite(bps) ? bps : 0, depositAmountCents: amount && !Number.isNaN(amount) ? amount : 0 }, tax && !Number.isNaN(tax) ? tax : 0);
  }, [v.lines, v.depositType, v.depositPercent, v.depositAmount, v.tax, taxEnabled]);

  const payload = JSON.stringify({
    customerName: v.customerName,
    customerEmail: v.customerEmail,
    customerPhone: v.customerPhone,
    customerAddress: v.customerAddress,
    customerNotes: v.customerNotes,
    terms: v.terms,
    expiresOn: v.expiresOn,
    leadTime: v.leadTime,
    estimatedCompletion: v.estimatedCompletion,
    deliveryDetails: v.deliveryDetails,
    depositType: v.depositType,
    depositPercent: v.depositPercent,
    depositAmountCents: v.depositType === "FIXED_AMOUNT" ? parseDollarsToCents(v.depositAmount) : null,
    taxCents: taxEnabled ? (parseDollarsToCents(v.tax) ?? 0) : 0,
    lines: v.lines.map((l) => ({
      sourceId: l.sourceId,
      kind: l.kind,
      description: l.description,
      notes: l.notes,
      quantity: lineQuantity(l),
      unitPriceCents: linePriceCents(l),
      taxable: l.taxable,
      productId: l.productId,
    })),
  });
  const money = (c: number) => (c < 0 ? `−${formatCents(-c, { showZeroCents: true })}` : formatCents(c, { showZeroCents: true }));

  return (
    <ActionForm action={action} className="space-y-6" successMessage="Draft saved.">
      <input type="hidden" name="payload" value={payload} />

      <Card title="Line items" description="Delivery, installation, discounts and fees are lines too. Prices are yours to set — they no longer follow the catalog.">
        <LineItemsEditor lines={v.lines} onChange={(lines) => set("lines", lines)} showTaxable={taxEnabled} issues={issues} />
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <button type="button" className={adminButton.secondary} onClick={() => set("lines", [...v.lines, blankLine("CUSTOM")])}>
            + Custom line
          </button>
          <button type="button" className={adminButton.secondary} onClick={() => set("lines", [...v.lines, blankLine("DELIVERY", { description: "Delivery" })])}>
            + Delivery
          </button>
          <button type="button" className={adminButton.secondary} onClick={() => set("lines", [...v.lines, blankLine("DISCOUNT", { description: "Discount" })])}>
            + Discount
          </button>
          <button type="button" className={adminButton.secondary} onClick={() => set("lines", [...v.lines, blankLine("INSTALLATION", { description: "Installation" })])}>
            + Installation
          </button>
          <div className="flex items-end gap-2">
            <label className="sr-only" htmlFor="add-product">
              Add a catalog product
            </label>
            <select id="add-product" value={addProduct} onChange={(e) => setAddProduct(e.target.value)} className={cn(input, "h-9 max-w-[14rem]")}>
              <option value="">Add a catalog product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={adminButton.secondary}
              disabled={!addProduct}
              onClick={() => {
                const p = products.find((x) => x.id === addProduct);
                if (!p) return;
                set("lines", [...v.lines, blankLine("PRODUCT", { description: p.name, productId: p.id, price: p.basePriceCents != null ? String(p.basePriceCents / 100) : "" })]);
                setAddProduct("");
              }}
            >
              Add
            </button>
          </div>
        </div>

        <dl className="ml-auto mt-6 max-w-sm space-y-1.5 text-sm" aria-live="polite">
          {[
            ["Subtotal", preview.subtotalCents],
            ["Discounts", -preview.discountCents],
            ["Delivery", preview.deliveryCents],
            ["Other charges", preview.otherChargesCents],
            ...(taxEnabled ? [["Tax", preview.taxCents] as [string, number]] : []),
          ].map(([label, c]) => (
            <div key={label as string} className="flex justify-between">
              <dt className="text-neutral-600">{label}</dt>
              <dd className="tabular-nums">{money(c as number)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-neutral-300 pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(preview.totalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-600">Deposit</dt>
            <dd className="tabular-nums">{money(preview.depositCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-600">Balance</dt>
            <dd className="tabular-nums">{money(preview.balanceCents)}</dd>
          </div>
        </dl>
        {preview.totalCents < 0 ? <p className="mt-2 text-right text-sm font-medium text-red-600">Discounts are larger than the total.</p> : null}
      </Card>

      <Card title="Deposit, dates and delivery">
        <div className="grid gap-4 md:grid-cols-3">
          <Labeled label="Deposit" htmlFor="q-deposit-type">
            <select id="q-deposit-type" value={v.depositType} onChange={(e) => set("depositType", e.target.value as DepositType)} className={cn(input, "h-10")}>
              <option value="PERCENTAGE">Percentage of total</option>
              <option value="FIXED_AMOUNT">Fixed amount</option>
              <option value="NONE">No deposit</option>
            </select>
          </Labeled>
          {v.depositType === "PERCENTAGE" ? (
            <Labeled label="Deposit %" htmlFor="q-deposit-pct" help="e.g. 50 or 33.33">
              <input id="q-deposit-pct" name="depositPercent" inputMode="decimal" value={v.depositPercent} onChange={(e) => set("depositPercent", e.target.value)} className={cn(input, "h-10")} />
            </Labeled>
          ) : null}
          {v.depositType === "FIXED_AMOUNT" ? (
            <Labeled label="Deposit amount ($)" htmlFor="q-deposit-amt" help="Never more than the total.">
              <input id="q-deposit-amt" name="depositAmount" inputMode="decimal" value={v.depositAmount} onChange={(e) => set("depositAmount", e.target.value)} className={cn(input, "h-10")} />
            </Labeled>
          ) : null}
          {taxEnabled ? (
            <Labeled label="Tax ($)" htmlFor="q-tax" help="Entered manually until tax rules are configured.">
              <input id="q-tax" inputMode="decimal" value={v.tax} onChange={(e) => set("tax", e.target.value)} className={cn(input, "h-10")} />
            </Labeled>
          ) : null}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Labeled label="Valid through" htmlFor="q-expires" help="Blank = the default from Settings when sent.">
            <input id="q-expires" name="expiresOn" type="date" value={v.expiresOn} onChange={(e) => set("expiresOn", e.target.value)} className={cn(input, "h-10")} />
          </Labeled>
          <Labeled label="Lead time" htmlFor="q-lead">
            <input id="q-lead" value={v.leadTime} maxLength={120} placeholder="e.g. 8–10 weeks" onChange={(e) => set("leadTime", e.target.value)} className={cn(input, "h-10")} />
          </Labeled>
          <Labeled label="Estimated completion" htmlFor="q-completion">
            <input id="q-completion" value={v.estimatedCompletion} maxLength={120} placeholder="e.g. Early March" onChange={(e) => set("estimatedCompletion", e.target.value)} className={cn(input, "h-10")} />
          </Labeled>
        </div>
        <Labeled label="Delivery details" htmlFor="q-delivery" className="mt-4">
          <textarea id="q-delivery" rows={2} maxLength={1000} value={v.deliveryDetails} onChange={(e) => set("deliveryDetails", e.target.value)} className={cn(input, "py-2")} />
        </Labeled>
      </Card>

      <Card title="Customer" description="As shown on this revision.">
        <div className="grid gap-4 md:grid-cols-2">
          <Labeled label="Name" htmlFor="q-name">
            <input id="q-name" name="customerName" value={v.customerName} maxLength={120} onChange={(e) => set("customerName", e.target.value)} className={cn(input, "h-10")} />
          </Labeled>
          <Labeled label="Email" htmlFor="q-email">
            <input id="q-email" name="customerEmail" type="email" value={v.customerEmail} maxLength={254} onChange={(e) => set("customerEmail", e.target.value)} className={cn(input, "h-10")} />
          </Labeled>
          <Labeled label="Phone" htmlFor="q-phone">
            <input id="q-phone" name="customerPhone" value={v.customerPhone} maxLength={30} onChange={(e) => set("customerPhone", e.target.value)} className={cn(input, "h-10")} />
          </Labeled>
          <Labeled label="Delivery address" htmlFor="q-address">
            <input id="q-address" name="customerAddress" value={v.customerAddress} maxLength={300} onChange={(e) => set("customerAddress", e.target.value)} className={cn(input, "h-10")} />
          </Labeled>
        </div>
      </Card>

      <Card title="Customer-facing notes and terms" description="Visible to the customer. Use the internal Notes panel for anything private.">
        <Labeled label="Notes to the customer" htmlFor="q-notes">
          <textarea id="q-notes" name="customerNotes" rows={4} maxLength={5000} value={v.customerNotes} onChange={(e) => set("customerNotes", e.target.value)} className={cn(input, "py-2")} />
        </Labeled>
        <Labeled label="Terms" htmlFor="q-terms" className="mt-4" help="Starts from the default terms in Settings.">
          <textarea id="q-terms" name="terms" rows={7} maxLength={20000} value={v.terms} onChange={(e) => set("terms", e.target.value)} className={cn(input, "py-2")} />
        </Labeled>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-md sm:border">
        <p className="text-sm text-neutral-600">
          Total <strong className="tabular-nums text-neutral-900">{money(preview.totalCents)}</strong>
          {Object.keys(issues).length ? <span className="ml-2 text-red-600">· {Object.keys(issues).length} line(s) need attention</span> : null}
        </p>
        <SubmitButton>Save draft</SubmitButton>
      </div>
    </ActionForm>
  );
}
