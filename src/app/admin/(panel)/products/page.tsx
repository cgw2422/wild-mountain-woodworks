import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma, ProductStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/cn";
import { saleStatus } from "@/lib/pricing/sale";
import { formatCents } from "@/lib/money";
import { AdminLinkButton, Badge, EmptyState, PageHeader, StatusBadge, adminButton, formatDate, table } from "@/components/admin/ui";
import { CatalogThumb } from "@/components/admin/catalog/CatalogThumb";

export const metadata: Metadata = { title: "Products" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "draft", label: "Draft" },
  { key: "archived", label: "Archived" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const STATUS_BY_TAB: Record<Exclude<TabKey, "all">, ProductStatus> = { active: "ACTIVE", draft: "DRAFT", archived: "ARCHIVED" };

type Search = { status?: string; q?: string; category?: string };

function hrefFor(params: Search, patch: Partial<Search>) {
  const next = { ...params, ...patch };
  const sp = new URLSearchParams();
  if (next.status && next.status !== "all") sp.set("status", next.status);
  if (next.q) sp.set("q", next.q);
  if (next.category) sp.set("category", next.category);
  const s = sp.toString();
  return `/admin/products${s ? `?${s}` : ""}`;
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  const status = (TABS.some((t) => t.key === one(raw.status)) ? one(raw.status) : "all") as TabKey;
  const q = one(raw.q)?.slice(0, 100);
  const category = one(raw.category);
  const params: Search = { status, q, category };

  const filters: Prisma.ProductWhereInput = {
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {}),
    ...(category ? { categoryId: category === "none" ? null : category } : {}),
  };
  const where: Prisma.ProductWhereInput = {
    ...filters,
    ...(status === "all" ? { status: { not: "ARCHIVED" } } : { status: STATUS_BY_TAB[status] }),
  };

  const [products, counts, categories, totalProducts] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      include: {
        category: { select: { name: true } },
        images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 1, include: { media: { select: { url: true, alt: true, focalX: true, focalY: true } } } },
      },
      take: 500,
    }),
    prisma.product.groupBy({ by: ["status"], where: filters, _count: { _all: true } }),
    prisma.category.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, archivedAt: true } }),
    prisma.product.count(),
  ]);
  const countFor = (s: ProductStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const tabCount: Record<TabKey, number> = {
    all: countFor("ACTIVE") + countFor("DRAFT"),
    active: countFor("ACTIVE"),
    draft: countFor("DRAFT"),
    archived: countFor("ARCHIVED"),
  };
  const filtered = Boolean(q || category);

  return (
    <>
      <PageHeader
        title="Products"
        description="Furniture in the catalog. Only active products appear on the site."
        actions={<AdminLinkButton href="/admin/products/new" variant="primary">New product</AdminLinkButton>}
      />

      {totalProducts === 0 ? (
        <EmptyState
          title="No products yet"
          description="Add your first piece of furniture. It starts as a draft, so nothing goes live until you publish it."
          action={<AdminLinkButton href="/admin/products/new" variant="primary">Create a product</AdminLinkButton>}
        />
      ) : (
        <>
          <nav aria-label="Product status" className="mb-4 flex gap-1 overflow-x-auto border-b border-neutral-200">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={hrefFor(params, { status: t.key })}
                aria-current={status === t.key ? "page" : undefined}
                className={cn(
                  "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
                  status === t.key ? "border-neutral-900 text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800",
                )}
              >
                {t.label} <span className="ml-1 text-xs tabular-nums text-neutral-400">{tabCount[t.key]}</span>
              </Link>
            ))}
          </nav>

          <form method="get" action="/admin/products" role="search" className="mb-4 flex flex-wrap items-end gap-3">
            {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
            <div className="min-w-[14rem] flex-1">
              <label htmlFor="product-search" className="mb-1.5 block text-sm font-medium text-neutral-800">
                Search
              </label>
              <input
                id="product-search"
                name="q"
                type="search"
                defaultValue={q}
                placeholder="Name or SKU"
                className="block h-10 w-full rounded border border-neutral-300 bg-white px-3 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
              />
            </div>
            <div className="w-56">
              <label htmlFor="product-category" className="mb-1.5 block text-sm font-medium text-neutral-800">
                Category
              </label>
              <select
                id="product-category"
                name="category"
                defaultValue={category ?? ""}
                className="block h-10 w-full rounded border border-neutral-300 bg-white px-3 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.archivedAt ? " (archived)" : ""}
                  </option>
                ))}
                <option value="none">No category</option>
              </select>
            </div>
            <button type="submit" className={adminButton.secondary}>
              Filter
            </button>
            {filtered ? (
              <Link href={hrefFor({ status }, {})} className={adminButton.ghost}>
                Clear
              </Link>
            ) : null}
          </form>

          {products.length === 0 ? (
            <EmptyState
              title={filtered ? "No products match your filters" : status === "archived" ? "No archived products" : status === "draft" ? "No drafts" : "No products here"}
              description={filtered ? "Try a different search or category." : status === "archived" ? "Archived products will appear here." : "Products with this status will appear here."}
              action={
                filtered ? (
                  <AdminLinkButton href={hrefFor({ status }, {})}>Clear filters</AdminLinkButton>
                ) : (
                  <AdminLinkButton href="/admin/products/new" variant="primary">
                    New product
                  </AdminLinkButton>
                )
              }
            />
          ) : (
            <div className={cn(table.wrap, "relative")}>
              <table className={table.table}>
                <thead className={table.thead}>
                  <tr>
                    <th scope="col" className={table.th}>
                      <span className="sr-only">Image</span>
                    </th>
                    <th scope="col" className={table.th}>Name</th>
                    <th scope="col" className={table.th}>Category</th>
                    <th scope="col" className={table.th}>Status</th>
                    <th scope="col" className={cn(table.th, "text-right")}>Price</th>
                    <th scope="col" className={table.th}>Featured</th>
                    <th scope="col" className={table.th}>Updated</th>
                  </tr>
                </thead>
                <tbody className={table.tbody}>
                  {products.map((p) => {
                    const img = p.images[0];
                    return (
                      <tr key={p.id} className={table.tr}>
                        <td className={cn(table.td, "w-16 py-2")}>
                          <CatalogThumb image={img ? { ...img.media, alt: "" } : null} className="w-11" />
                        </td>
                        <td className={cn(table.td, "min-w-[14rem]")}>
                          <Link href={`/admin/products/${p.id}`} className="font-medium text-neutral-900 hover:underline">
                            {p.name}
                          </Link>
                          <p className="font-mono text-xs text-neutral-500">{p.sku ?? "No SKU"}</p>
                        </td>
                        <td className={cn(table.td, "whitespace-nowrap")}>{p.category?.name ?? <span className="text-neutral-400">None</span>}</td>
                        <td className={table.td}>
                          <StatusBadge status={p.status} />
                        </td>
                        <td className={cn(table.td, "whitespace-nowrap text-right tabular-nums")}>
                          {p.basePriceCents == null ? (
                            <span className="text-neutral-400">No price</span>
                          ) : p.showPrice ? (
                            saleStatus(p) === "active" ? (
                              <span title={`Regular ${formatCents(p.basePriceCents)}`}>
                                <del className="mr-1.5 text-neutral-400">{formatCents(p.basePriceCents)}</del>
                                <span className="font-medium text-emerald-700">{formatCents(p.salePriceCents!)}</span>
                              </span>
                            ) : (
                              formatCents(p.basePriceCents)
                            )
                          ) : (
                            <span className="text-neutral-500" title={`Base price ${formatCents(p.basePriceCents)} (hidden from customers)`}>
                              Price hidden
                            </span>
                          )}
                        </td>
                        <td className={table.td}>{p.featured ? <Badge tone="blue">★ Featured</Badge> : <span className="sr-only">No</span>}</td>
                        <td className={cn(table.td, "whitespace-nowrap text-neutral-600")}>{formatDate(p.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {products.length === 500 ? <p className="mt-3 text-xs text-neutral-500">Showing the 500 most recently updated products. Use search to narrow down.</p> : null}
        </>
      )}
    </>
  );
}
