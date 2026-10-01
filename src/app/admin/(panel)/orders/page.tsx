import type { Metadata } from "next";
import Link from "next/link";
import type { OrderPaymentStatus, Prisma, ProductionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { PRODUCTION_ACTIVE } from "@/lib/sales/status";
import { orderSearch } from "@/lib/sales/list-filters";
import { EmptyState, PageHeader, formatDate, table } from "@/components/admin/ui";
import { FilterTabs, PAGE_SIZE, Pagination, SearchBox, listHref, pageParam, param } from "@/components/admin/inbox/ListControls";
import { Money } from "@/components/admin/sales/Money";
import { SalesBadge } from "@/components/admin/sales/SalesBadge";

export const metadata: Metadata = { title: "Orders" };

const BASE = "/admin/orders";
const TABS: Array<{ key: string; label: string; where?: Prisma.OrderWhereInput }> = [
  { key: "", label: "All", where: { productionStatus: { not: "CANCELED" } } },
  { key: "deposit", label: "Awaiting deposit", where: { productionStatus: "AWAITING_DEPOSIT" } },
  { key: "production", label: "In the shop", where: { productionStatus: { in: PRODUCTION_ACTIVE } } },
  { key: "delivery", label: "Ready / delivery", where: { productionStatus: { in: ["READY_FOR_DELIVERY", "DELIVERY_SCHEDULED"] as ProductionStatus[] } } },
  { key: "balance", label: "Balance due", where: { paymentStatus: "BALANCE_DUE", productionStatus: { notIn: ["CANCELED"] } } },
  { key: "unpaid", label: "Not yet paid in full", where: { paymentStatus: { in: ["PARTIALLY_PAID", "DEPOSIT_DUE", "UNPAID", "BALANCE_DUE"] as OrderPaymentStatus[] }, productionStatus: { notIn: ["CANCELED"] } } },
  { key: "completed", label: "Completed", where: { productionStatus: "COMPLETED" } },
  { key: "canceled", label: "Canceled", where: { productionStatus: "CANCELED" } },
];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("sales");
  const sp = await searchParams;
  const key = TABS.find((t) => t.key === param(sp, "status"))?.key ?? "";
  const tab = TABS.find((t) => t.key === key)!;
  const q = param(sp, "q").slice(0, 100);
  const page = pageParam(sp);
  const where: Prisma.OrderWhereInput = { AND: [orderSearch(q), tab.where ?? {}] };
  const [rows, total, counts] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { quote: { select: { number: true } }, items: { select: { description: true, productName: true, kind: true }, orderBy: { position: "asc" }, take: 2 } },
    }),
    prisma.order.count({ where }),
    Promise.all(TABS.map((t) => prisma.order.count({ where: { AND: [orderSearch(q), t.where ?? {}] } }))),
  ]);
  return (
    <>
      <PageHeader title="Orders" description="Created automatically when a customer accepts a quote. Track production, delivery and payments here." />
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <FilterTabs active={key} tabs={TABS.map((t, i) => ({ key: t.key, label: t.label, count: counts[i], href: listHref(BASE, { status: t.key, q }) }))} />
        <SearchBox action={BASE} q={q} placeholder="Order, quote, name or email" hidden={{ status: key }} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title={q || key ? "No matching orders" : "No orders yet"} description={q || key ? "Try a different search or filter." : "When a customer accepts a quote, its order appears here."} />
      ) : (
        <>
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.thead}>
                <tr>
                  <th scope="col" className={table.th}>Order</th>
                  <th scope="col" className={table.th}>Customer</th>
                  <th scope="col" className={table.th}>Piece</th>
                  <th scope="col" className={cn(table.th, "text-right")}>Total</th>
                  <th scope="col" className={table.th}>Production</th>
                  <th scope="col" className={table.th}>Payment</th>
                  <th scope="col" className={table.th}>Delivery</th>
                </tr>
              </thead>
              <tbody className={table.tbody}>
                {rows.map((o) => (
                  <tr key={o.id} className={table.tr}>
                    <td className={cn(table.td, "whitespace-nowrap")}>
                      <Link href={`${BASE}/${o.id}`} className="inline-block py-1 font-mono text-xs font-semibold hover:underline">
                        {o.number}
                      </Link>
                      <p className="text-xs text-neutral-500">
                        {formatDate(o.createdAt)}
                        {o.quote?.number ? ` · ${o.quote.number}` : ""}
                      </p>
                    </td>
                    <td className={table.td}>
                      <p className="font-medium">{o.customerName}</p>
                      <p className="text-xs text-neutral-500">{o.customerEmail}</p>
                    </td>
                    <td className={table.td}>{o.items.find((i) => i.kind === "PRODUCT" || i.kind === "CUSTOM")?.description ?? o.items[0]?.productName ?? "—"}</td>
                    <td className={cn(table.td, "text-right")}>
                      <Money cents={o.totalCents} />
                    </td>
                    <td className={table.td}>
                      <SalesBadge status={o.productionStatus} />
                    </td>
                    <td className={table.td}>
                      <SalesBadge status={o.paymentStatus} />
                    </td>
                    <td className={cn(table.td, "whitespace-nowrap text-neutral-600")}>{o.deliveryDate ? formatDate(o.deliveryDate) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} href={(p) => listHref(BASE, { status: key, q, page: p })} />
        </>
      )}
    </>
  );
}
