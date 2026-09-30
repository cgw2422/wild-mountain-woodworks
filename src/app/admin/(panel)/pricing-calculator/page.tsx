import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { fmtPct } from "@/lib/pricing/estimator";
import { AdminLinkButton, EmptyState, PageHeader, formatDate, table } from "@/components/admin/ui";
import { ActionButton } from "@/components/admin/forms";
import { cn } from "@/lib/cn";
import { Calculator } from "./Calculator";
import { duplicateEstimate, setEstimateArchived } from "./actions";
import { loadCalculatorContext } from "./data";

export const metadata: Metadata = { title: "Pricing calculator" };
export const dynamic = "force-dynamic";

type SP = Promise<{ product?: string; quote?: string; view?: string }>;

export default async function PricingCalculatorPage({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
  const sp = await searchParams;
  const ctx = await loadCalculatorContext();
  const showArchived = sp.view === "archived";
  const [estimates, archivedCount, quote] = await Promise.all([
    prisma.priceEstimate.findMany({
      where: { archivedAt: showArchived ? { not: null } : null },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { product: { select: { name: true } }, quoteRequest: { select: { id: true, reference: true } } },
    }),
    prisma.priceEstimate.count({ where: { archivedAt: { not: null } } }),
    sp.quote ? prisma.quoteRequest.findUnique({ where: { id: sp.quote } }) : null,
  ]);
  const productId = sp.product ?? quote?.productId ?? undefined;
  const validProduct = productId && ctx.products.some((p) => p.id === productId) ? productId : undefined;

  return (
    <>
      <PageHeader
        title="Pricing calculator"
        description="Internal only. Recommended price = the higher of the 30% material-cost floor (materials ÷ 0.30) and the detailed cost-based price, plus any value adjustments you choose."
        actions={<AdminLinkButton href="/admin/settings/pricing">Pricing defaults</AdminLinkButton>}
      />

      {quote ? (
        <p className="mb-4 rounded bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Pricing quote <Link href={`/admin/quotes/${quote.id}`} className="font-medium underline">{quote.reference}</Link> for {quote.name}. Customer details have been filled in.
        </p>
      ) : null}

      <Calculator
        key={`${validProduct ?? ""}-${quote?.id ?? ""}`}
        estimate={null}
        initialInputs={ctx.defaults}
        thresholds={ctx.thresholds}
        products={ctx.products}
        autoLoadProduct={Boolean(validProduct)}
        prefill={{
          productId: validProduct,
          name: quote ? `${quote.name} — ${quote.productName ?? "Custom piece"}` : undefined,
          customerName: quote?.name,
          customerEmail: quote?.email,
          customerPhone: quote?.phone ?? undefined,
          customerZip: quote?.zipCode,
          notes: quote?.requestedDimensions ? `Requested dimensions: ${quote.requestedDimensions}` : undefined,
        }}
      />

      <section className="mt-10" aria-labelledby="saved-estimates">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="saved-estimates" className="text-lg font-semibold">
            Saved estimates
          </h2>
          <nav className="flex gap-1 text-sm" aria-label="Estimate filter">
            <Link href="/admin/pricing-calculator" className={cn("rounded px-3 py-1.5", !showArchived ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")}>
              Active
            </Link>
            <Link href="/admin/pricing-calculator?view=archived" className={cn("rounded px-3 py-1.5", showArchived ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")}>
              Archived ({archivedCount})
            </Link>
          </nav>
        </div>
        {estimates.length ? (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.thead}>
                <tr>
                  <th className={table.th}>Estimate</th>
                  <th className={table.th}>Product</th>
                  <th className={cn(table.th, "text-right")}>Materials</th>
                  <th className={cn(table.th, "text-right")}>30% floor</th>
                  <th className={cn(table.th, "text-right")}>Final price</th>
                  <th className={cn(table.th, "text-right")}>Gross margin</th>
                  <th className={cn(table.th, "text-right")}>Deposit</th>
                  <th className={table.th}>Updated</th>
                  <th className={table.th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className={table.tbody}>
                {estimates.map((e) => {
                  const price = e.finalPriceCents;
                  return (
                    <tr key={e.id} className={table.tr}>
                      <td className={table.td}>
                        <Link href={`/admin/pricing-calculator/${e.id}`} className="inline-block py-1 font-medium hover:underline">
                          {e.name}
                        </Link>
                        <p className="text-xs text-neutral-500">
                          {e.customerName ?? "No customer"}
                          {e.quoteRequest ? ` · Quote ${e.quoteRequest.reference}` : ""}
                        </p>
                      </td>
                      <td className={table.td}>
                        {e.product?.name ?? e.productType ?? <span className="text-neutral-400">Custom</span>}
                        {e.woodSpecies || e.dimensions ? <p className="text-xs text-neutral-500">{[e.woodSpecies, e.dimensions].filter(Boolean).join(" · ")}</p> : null}
                      </td>
                      <td className={cn(table.td, "text-right tabular-nums")}>{formatCents(e.materialCostCents)}</td>
                      <td className={cn(table.td, "text-right tabular-nums")}>{formatCents(e.floorCents)}</td>
                      <td className={cn(table.td, "text-right tabular-nums")}>
                        {price != null ? formatCents(price) : "—"}
                        {price != null && price < e.floorCents ? <span className="block text-xs font-medium text-red-700">Below floor</span> : null}
                        {e.valueAdjustmentCents ? <span className="block text-xs text-neutral-500">incl. +{formatCents(e.valueAdjustmentCents)} adj.</span> : null}
                      </td>
                      <td className={cn(table.td, "text-right tabular-nums")}>{fmtPct(e.grossMarginPct)}</td>
                      <td className={cn(table.td, "text-right tabular-nums")}>
                        {formatCents(e.depositCents)}
                        <span className="block text-xs text-neutral-500">bal. {formatCents(e.balanceCents)}</span>
                      </td>
                      <td className={cn(table.td, "whitespace-nowrap")}>{formatDate(e.updatedAt)}</td>
                      <td className={cn(table.td, "whitespace-nowrap text-right")}>
                        <span className="inline-flex gap-2">
                          <ActionButton variant="small" action={duplicateEstimate.bind(null, e.id)} successMessage="Estimate duplicated.">
                            Duplicate
                          </ActionButton>
                          <ActionButton variant="small" action={setEstimateArchived.bind(null, e.id, !showArchived)}>
                            {showArchived ? "Restore" : "Archive"}
                          </ActionButton>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={showArchived ? "No archived estimates" : "No saved estimates yet"}
            description={showArchived ? "Archived estimates appear here." : "Build an estimate above and save it to keep it for later, duplicate it for similar pieces, or turn it into a quote."}
          />
        )}
      </section>
    </>
  );
}
