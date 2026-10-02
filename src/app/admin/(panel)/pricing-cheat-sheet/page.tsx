import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { loadConfigurableProduct } from "@/lib/pricing/load";
import { buildCheatSheet, resolveAxes, type CheatSheet } from "@/lib/pricing/cheat-sheet";
import { formatCents } from "@/lib/money";
import { Card, EmptyState, PageHeader, formatDate } from "@/components/admin/ui";
import { AutoSubmitSelect } from "./AutoSubmitSelect";
import { PriceStack } from "./PriceStack";
import { QuickPriceFinder } from "./QuickPriceFinder";

export const metadata: Metadata = { title: "Pricing cheat sheet" };
export const dynamic = "force-dynamic";

type SP = Promise<{ product?: string; rows?: string; cols?: string; base?: string }>;

const selectCls = "mt-1 block h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900";

/**
 * Read-only price reference for answering customers fast (phone, Messenger).
 * Every price is calculated live by the product page's pricing engine from
 * the current product (core price, active sale on the core price only,
 * active option values, per-product overrides, conditional prices) — see
 * src/lib/pricing/cheat-sheet.ts. Nothing is stored; nothing is modified.
 */
export default async function PricingCheatSheetPage({ searchParams }: { searchParams: SP }) {
  await requirePermission("catalog");
  const sp = await searchParams;
  // Products customers can configure right now.
  const products = await prisma.product.findMany({
    where: { status: "ACTIVE", basePriceCents: { not: null }, optionGroups: { some: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  if (!products.length) {
    return (
      <>
        <PageHeader title="Pricing Cheat Sheet" />
        <EmptyState title="No products to price yet" description="Publish a product with a base price and options, and its prices appear here automatically." />
      </>
    );
  }

  const productId = products.some((p) => p.id === sp.product) ? sp.product! : products[0]!.id;
  const product = (await loadConfigurableProduct({ id: productId }))!;
  const axes = resolveAxes(product, { rowGroupId: sp.rows, columnGroupId: sp.cols, baseGroupId: sp.base });
  const sheet = buildCheatSheet(product, axes);
  const groupOptions = product.optionGroups.filter((g) => g.values.some((v) => !v.isCustom));
  const multiBucket = sheet.buckets.length > 1 || Boolean(sheet.buckets[0]?.label);

  return (
    <>
      <PageHeader
        title="Pricing Cheat Sheet"
        description="Live prices from the current product, options and sale — exactly what the website charges. Read-only."
        actions={
          <Link href={`/admin/products/${product.id}#options`} className="text-sm text-neutral-600 underline">
            Edit {product.name}
          </Link>
        }
      />

      <form method="get" className="mb-5 grid gap-3 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start" aria-label="What to show">
        <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Product
          <AutoSubmitSelect name="product" defaultValue={product.id} className={selectCls}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </AutoSubmitSelect>
        </label>
        {/* Which option is rows / columns / per-cell choice — guessed from the names, rarely changed, so tucked away. */}
        <details className="rounded-md border border-neutral-200 bg-white px-3 py-2 lg:mt-5">
          <summary className="flex min-h-7 cursor-pointer items-center text-sm text-neutral-700">
            Layout: {[sheet.groupNames.row, sheet.groupNames.column, sheet.groupNames.base].filter(Boolean).join(" × ") || "—"} <span className="ml-1 text-neutral-500">(change)</span>
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {(
              [
                ["rows", "Rows", axes.rowGroupId],
                ["cols", "Columns", axes.columnGroupId],
                ["base", "Base / per-cell choice", axes.baseGroupId],
              ] as const
            ).map(([name, label, current]) => (
              <label key={name} className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {label}
                <AutoSubmitSelect name={name} defaultValue={current ?? "none"} className={selectCls}>
                  <option value="none">— None —</option>
                  {groupOptions.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.displayName}
                    </option>
                  ))}
                </AutoSubmitSelect>
              </label>
            ))}
          </div>
        </details>
        <noscript>
          <button type="submit" className="h-11 rounded-md bg-neutral-900 px-4 text-sm text-white">
            Show
          </button>
        </noscript>
      </form>

      {product.sale ? <SaleBanner sale={product.sale} /> : null}

      <Card title="Quick Price Finder" className="mb-6">
        <QuickPriceFinder sheet={sheet} />
      </Card>

      {sheet.fixed.length ? (
        <p className="mb-4 text-xs text-neutral-500">
          Every price includes the default choice for: {sheet.fixed.map((f) => `${f.group} — ${f.value}`).join(" · ")}. Add-ons are extra.
        </p>
      ) : (
        <p className="mb-4 text-xs text-neutral-500">Add-ons are extra.</p>
      )}

      {/* Phones: one card per column value (e.g. per wood species). */}
      <div className="md:hidden">
        {sheet.columns.length > 1 ? (
          <nav aria-label={`Jump to ${sheet.groupNames.column ?? "column"}`} className="mb-4 flex flex-wrap gap-2">
            {sheet.columns.map((c) => (
              <a key={c.id} href={`#col-${c.id}`} className="inline-flex min-h-11 items-center rounded-full border border-neutral-300 bg-white px-4 text-sm">
                {c.label}
              </a>
            ))}
          </nav>
        ) : null}
        <div className="grid gap-4">
          {sheet.columns.map((c) => (
            <section key={c.id} id={`col-${c.id}`} className="scroll-mt-4 rounded-lg border border-neutral-200 bg-white" aria-labelledby={`col-h-${c.id}`}>
              <h2 id={`col-h-${c.id}`} className="border-b border-neutral-100 px-4 py-3 text-base font-semibold text-neutral-900">
                {sheet.columns.length > 1 || sheet.groupNames.column ? c.label : product.name}
              </h2>
              <ul className="divide-y divide-neutral-100">
                {sheet.rows.map((r) => (
                  <li key={r.id} className="px-4 py-3">
                    <p className="text-sm font-medium text-neutral-900">{r.label}</p>
                    <dl className="mt-1 grid gap-1">
                      {sheet.buckets.map((b) => (
                        <div key={b.key} className="flex items-baseline justify-between gap-3">
                          <dt className="text-sm text-neutral-600">{b.label || "Price"}</dt>
                          <dd>
                            <PriceStack price={sheet.cells[r.id]?.[c.id]?.[b.key]} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      {/* Desktop/tablet: the grid. */}
      <div className="hidden overflow-x-auto rounded-lg border border-neutral-200 bg-white md:block">
        <CheatTable sheet={sheet} multiBucket={multiBucket} />
      </div>
    </>
  );
}

function CheatTable({ sheet, multiBucket }: { sheet: CheatSheet; multiBucket: boolean }) {
  return (
    <table className="min-w-full text-sm">
      <caption className="sr-only">
        Prices by {sheet.groupNames.row ?? "size"}
        {sheet.groupNames.column ? ` and ${sheet.groupNames.column}` : ""}
      </caption>
      <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
        <tr>
          <th scope="col" className="sticky left-0 bg-neutral-50 px-4 py-3">
            {sheet.groupNames.row ?? ""}
          </th>
          {sheet.columns.map((c) => (
            <th key={c.id} scope="col" className="px-4 py-3 text-right">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {sheet.rows.map((r) => (
          <tr key={r.id} className="align-top">
            <th scope="row" className="sticky left-0 whitespace-nowrap bg-white px-4 py-3 text-left font-medium text-neutral-900">
              {r.label}
            </th>
            {sheet.columns.map((c) => (
              <td key={c.id} className="px-4 py-3">
                <dl className="grid gap-1.5">
                  {sheet.buckets.map((b) => (
                    <div key={b.key} className="text-right">
                      {multiBucket ? <dt className="text-[0.7rem] leading-tight text-neutral-500">{b.label}</dt> : <dt className="sr-only">Price</dt>}
                      <dd>
                        <PriceStack price={sheet.cells[r.id]?.[c.id]?.[b.key]} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SaleBanner({ sale }: { sale: NonNullable<CheatSheet["sale"]> }) {
  return (
    <p role="status" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
      <strong>Sale on now</strong>
      {sale.label ? ` — ${sale.label}` : ""}: {sale.percent != null ? `${sale.percent}% off` : "sale price"} the core price ({formatCents(sale.regularBasePriceCents)} regular)
      {sale.endsAt ? `, ends ${formatDate(sale.endsAt)}` : ""}. Size, wood, base and other option upcharges are not discounted. Prices show <span className="line-through">regular</span> and{" "}
      <strong>sale</strong>.
    </p>
  );
}
