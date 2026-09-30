"use client";

import { useMemo, useState } from "react";
import type { ActionResult } from "@/lib/admin/types";
import { computeTotals } from "@/lib/sales/totals";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { Card, adminButton } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { LineItemsEditor, blankLine, lineIssues, linePriceCents, lineQuantity, type EditableLine } from "./LineItemsEditor";
import { money } from "./Money";

const input = "block w-full rounded border border-neutral-300 bg-white px-3 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900";

/** Draft invoice editor (and the "new custom invoice" form). */
export function InvoiceEditor({
  action,
  initial,
  extra = {},
  showCustomer = true,
  submitLabel = "Save draft",
  redirectToId,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  initial: { customerName: string; customerEmail: string; dueOn: string; customerNotes: string; lines: EditableLine[] };
  /** Extra payload fields (e.g. customerId/orderId for a new invoice). */
  extra?: Record<string, string | null>;
  showCustomer?: boolean;
  submitLabel?: string;
  /** Navigate to `${redirectToId}${result.id}` after saving (new invoices). */
  redirectToId?: string;
}) {
  const [v, setV] = useState(initial);
  const issues = lineIssues(v.lines);
  const totals = useMemo(() => computeTotals(v.lines.map((l) => ({ kind: l.kind, quantity: lineQuantity(l) || 0, unitPriceCents: linePriceCents(l) || 0 })), { depositType: "NONE" }), [v.lines]);
  const payload = JSON.stringify({
    ...extra,
    customerName: v.customerName,
    customerEmail: v.customerEmail,
    dueOn: v.dueOn,
    customerNotes: v.customerNotes,
    lines: v.lines.map((l) => ({ kind: l.kind, description: l.description, notes: l.notes, quantity: lineQuantity(l), unitPriceCents: linePriceCents(l), taxable: l.taxable })),
  });
  return (
    <ActionForm action={action} className="space-y-6" successMessage={redirectToId ? null : "Draft saved."} redirectToId={redirectToId}>
      <input type="hidden" name="payload" value={payload} />
      <Card title="Lines">
        <LineItemsEditor lines={v.lines} onChange={(lines) => setV((s) => ({ ...s, lines }))} showTaxable={false} issues={issues} />
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={adminButton.secondary} onClick={() => setV((s) => ({ ...s, lines: [...s.lines, blankLine("CUSTOM")] }))}>
            + Line
          </button>
          <button type="button" className={adminButton.secondary} onClick={() => setV((s) => ({ ...s, lines: [...s.lines, blankLine("DELIVERY", { description: "Delivery" })] }))}>
            + Delivery
          </button>
          <button type="button" className={adminButton.secondary} onClick={() => setV((s) => ({ ...s, lines: [...s.lines, blankLine("DISCOUNT", { description: "Discount" })] }))}>
            + Discount
          </button>
        </div>
        <p className="mt-4 text-right text-base font-semibold">
          Total <span className="tabular-nums">{money(totals.totalCents)}</span>
        </p>
      </Card>
      <Card title="Details">
        <div className="grid gap-4 md:grid-cols-3">
          {showCustomer ? (
            <>
              <div>
                <label htmlFor="i-name" className="mb-1.5 block text-sm font-medium">
                  Bill to
                </label>
                <input id="i-name" name="customerName" value={v.customerName} maxLength={120} onChange={(e) => setV((s) => ({ ...s, customerName: e.target.value }))} className={cn(input, "h-10")} />
              </div>
              <div>
                <label htmlFor="i-email" className="mb-1.5 block text-sm font-medium">
                  Email
                </label>
                <input id="i-email" name="customerEmail" type="email" value={v.customerEmail} maxLength={254} onChange={(e) => setV((s) => ({ ...s, customerEmail: e.target.value }))} className={cn(input, "h-10")} />
              </div>
            </>
          ) : null}
          <div>
            <label htmlFor="i-due" className="mb-1.5 block text-sm font-medium">
              Due date
            </label>
            <input id="i-due" name="dueOn" type="date" value={v.dueOn} onChange={(e) => setV((s) => ({ ...s, dueOn: e.target.value }))} className={cn(input, "h-10")} />
          </div>
        </div>
        <div className="mt-4">
          <label htmlFor="i-notes" className="mb-1.5 block text-sm font-medium">
            Notes to the customer
          </label>
          <textarea id="i-notes" name="customerNotes" rows={3} maxLength={5000} value={v.customerNotes} onChange={(e) => setV((s) => ({ ...s, customerNotes: e.target.value }))} className={cn(input, "py-2")} />
        </div>
      </Card>
      <div className="flex justify-end">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
