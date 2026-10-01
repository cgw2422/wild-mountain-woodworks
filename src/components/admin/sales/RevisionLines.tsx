import { LINE_KIND_LABELS, type LineKind } from "@/lib/sales/totals";
import { formatCents } from "@/lib/money";
import { addOnChoicesText, parseAddOnLine } from "@/lib/pricing/snapshot";
import { table } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { Money } from "./Money";

type Line = { id?: string; kind: string; description: string; notes: string | null; quantity: number; unitPriceCents: number; lineTotalCents: number; addOn?: unknown };
type Totals = { subtotalCents: number; discountCents: number; deliveryCents: number; otherChargesCents: number; taxCents: number; totalCents: number; depositCents?: number; balanceCents?: number };

/** Read-only line table + totals (sent revisions, invoices, accepted snapshots). */
export function RevisionLines({ lines, totals, extra = [] }: { lines: Line[]; totals: Totals; extra?: Array<{ label: string; cents: number }> }) {
  const rows: Array<[string, number, boolean?]> = [
    ["Subtotal", totals.subtotalCents],
    ...(totals.discountCents ? [["Discounts", -totals.discountCents] as [string, number]] : []),
    ...(totals.deliveryCents ? [["Delivery", totals.deliveryCents] as [string, number]] : []),
    ...(totals.otherChargesCents ? [["Other charges", totals.otherChargesCents] as [string, number]] : []),
    ...(totals.taxCents ? [["Tax", totals.taxCents] as [string, number]] : []),
    ["Total", totals.totalCents, true],
    ...(totals.depositCents ? [["Deposit", totals.depositCents] as [string, number], ["Balance", totals.balanceCents ?? 0] as [string, number]] : []),
    ...extra.map((e) => [e.label, e.cents] as [string, number]),
  ];
  return (
    <>
      <div className={table.wrap}>
        <table className={table.table}>
          <thead className={table.thead}>
            <tr>
              <th scope="col" className={table.th}>Item</th>
              <th scope="col" className={cn(table.th, "text-right")}>Qty</th>
              <th scope="col" className={cn(table.th, "text-right")}>Each</th>
              <th scope="col" className={cn(table.th, "text-right")}>Total</th>
            </tr>
          </thead>
          <tbody className={table.tbody}>
            {lines.map((l, i) => (
              <tr key={l.id ?? i}>
                <td className={cn(table.td, parseAddOnLine(l.addOn) && "pl-8")}>
                  <AdminLineDescription line={l} />
                </td>
                <td className={cn(table.td, "text-right tabular-nums")}>{l.quantity}</td>
                <td className={cn(table.td, "text-right")}>
                  <Money cents={l.unitPriceCents} />
                </td>
                <td className={cn(table.td, "text-right")}>
                  <Money cents={l.lineTotalCents} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
        {rows.map(([label, cents, strong]) => (
          <div key={label} className={cn("flex justify-between", strong && "border-t border-neutral-300 pt-1.5 text-base font-semibold")}>
            <dt className={strong ? "" : "text-neutral-600"}>{label}</dt>
            <dd>
              <Money cents={cents} />
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** Description cell: a configured add-on shows as "Add-on of <product>" with its choices, grouped under that product. */
function AdminLineDescription({ line: l }: { line: Line }) {
  const addOn = parseAddOnLine(l.addOn);
  return (
    <div className={cn(addOn && "border-l-2 border-amber-300 pl-3")}>
      <p className="font-medium">{l.description}</p>
      <p className="text-xs text-neutral-500">{addOn ? `Add-on of ${addOn.parentProduct.name}` : (LINE_KIND_LABELS[l.kind as LineKind] ?? l.kind)}</p>
      {addOn ? (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs text-neutral-700">
          {addOn.choices.map((c) => (
            <div key={c.label} className="contents">
              <dt className="text-neutral-500">{c.label}</dt>
              <dd>{c.value}</dd>
            </div>
          ))}
          <dt className="text-neutral-500">Price per unit</dt>
          <dd>{formatCents(addOn.unitPriceCents)} (base {formatCents(addOn.basePriceCents)})</dd>
        </dl>
      ) : null}
      {l.notes && !(addOn && l.notes.trim() === addOnChoicesText(addOn.choices)) ? <p className="mt-1 whitespace-pre-line text-xs text-neutral-600">{l.notes}</p> : null}
    </div>
  );
}
