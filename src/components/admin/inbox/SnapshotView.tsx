import Link from "next/link";
import { Badge, formatDate } from "@/components/admin/ui";
import { formatCents, formatModifier } from "@/lib/money";
import type { ConfigurationSnapshot } from "@/lib/pricing/snapshot";

/**
 * Renders an immutable ConfigurationSnapshot (quote requests and order items).
 * Everything shown comes from the snapshot itself — never from the live
 * product — so later catalog edits can't change what the customer requested.
 */
export function SnapshotView({
  snapshot,
  currentProductId,
  compact = false,
}: {
  snapshot: ConfigurationSnapshot;
  /** Set when the product still exists, to offer a link to it. */
  currentProductId?: string | null;
  compact?: boolean;
}) {
  const s = snapshot;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-neutral-900">{s.product.name}</p>
          <p className="text-xs text-neutral-500">
            SKU: <span className="font-mono">{s.product.sku ?? "—"}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {s.requiresCustomQuote ? <Badge tone="amber">Requires custom quote</Badge> : null}
          <Badge tone={s.priceShownToCustomer ? "green" : "neutral"}>{s.priceShownToCustomer ? "Price shown to customer" : "Price not shown to customer"}</Badge>
        </div>
      </div>

      {s.options.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Selected options</caption>
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th scope="col" className="py-2 pr-4 font-semibold">Option</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Choice</th>
                <th scope="col" className="py-2 text-right font-semibold">Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {s.options.map((o) => (
                <tr key={o.groupId}>
                  <th scope="row" className="py-2 pr-4 text-left align-top font-normal text-neutral-500">
                    {o.groupDisplayName}
                  </th>
                  <td className="py-2 pr-4 align-top text-neutral-900">
                    {o.valueDisplayName}
                    {o.isCustom ? (
                      <span className="ml-1.5">
                        <Badge tone="violet">Custom</Badge>
                      </span>
                    ) : null}
                    {o.customDetails ? <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-700">Details: {o.customDetails}</p> : null}
                  </td>
                  <td className="py-2 text-right align-top tabular-nums text-neutral-700">{formatModifier(o.priceModifierCents) || "Included"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-neutral-500">No options were selected.</p>
      )}

      {s.addOns.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <caption className="mb-1 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Add-ons</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Add-on</th>
                <th scope="col">Quantity</th>
                <th scope="col">Unit price</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {s.addOns.map((a) => (
                <tr key={a.addOnId}>
                  <th scope="row" className="py-2 pr-4 text-left font-normal text-neutral-900">{a.name}</th>
                  <td className="py-2 pr-4 tabular-nums text-neutral-700">× {a.quantity}</td>
                  <td className="py-2 pr-4 tabular-nums text-neutral-500">{formatCents(a.unitPriceCents)} each</td>
                  <td className="py-2 text-right tabular-nums text-neutral-900">{formatCents(a.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <dl className="space-y-1 border-t border-neutral-200 pt-3">
        <div className="flex justify-between gap-4">
          <dt className="text-neutral-500">{s.sale ? `Base price (${s.sale.label || "sale"})` : "Base price"}</dt>
          <dd className="tabular-nums">
            {s.sale ? <del className="mr-2 text-neutral-400">{formatCents(s.sale.regularBasePriceCents)}</del> : null}
            {s.basePriceCents != null ? formatCents(s.basePriceCents) : "Priced by quote"}
          </dd>
        </div>
        {s.sale ? (
          <div className="flex justify-between gap-4 text-bronze-text">
            <dt>Sale savings</dt>
            <dd className="tabular-nums">−{formatCents(s.sale.savingsCents)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4 font-semibold">
          <dt>Estimated total</dt>
          <dd className="tabular-nums">{s.totalCents != null ? formatCents(s.totalCents) : "Custom quote required"}</dd>
        </div>
      </dl>

      {!compact ? (
        <p className="rounded bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
          Snapshot captured {formatDate(s.capturedAt, true)} at submission time. It will not change if the product, its options or add-ons are edited
          later.{" "}
          {currentProductId ? (
            <Link href={`/admin/products/${currentProductId}`} className="font-medium text-neutral-900 underline underline-offset-2">
              View current product
            </Link>
          ) : (
            <span>The original product no longer exists.</span>
          )}
        </p>
      ) : null}
    </div>
  );
}
