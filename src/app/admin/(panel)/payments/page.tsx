import type { Metadata } from "next";
import Link from "next/link";
import type { PaymentMethod, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { PAYMENT_METHOD_LABELS } from "@/lib/sales/status";
import { EmptyState, PageHeader, formatDate, table } from "@/components/admin/ui";
import { FilterTabs, PAGE_SIZE, Pagination, SearchBox, listHref, pageParam, param } from "@/components/admin/inbox/ListControls";
import { Money } from "@/components/admin/sales/Money";
import { SalesBadge } from "@/components/admin/sales/SalesBadge";

export const metadata: Metadata = { title: "Payments" };

const BASE = "/admin/payments";
const TABS: Array<{ key: string; label: string; where?: Prisma.PaymentWhereInput }> = [
  { key: "", label: "All" },
  { key: "stripe", label: "Stripe", where: { source: "STRIPE" } },
  { key: "manual", label: "Manual", where: { source: "MANUAL" } },
  { key: "refunds", label: "Refunds", where: { refundedCents: { gt: 0 } } },
  { key: "void", label: "Voided", where: { status: "VOIDED" } },
];

/** Payment history across all invoices. Payments are never deleted. */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("finance");
  const sp = await searchParams;
  const key = TABS.find((t) => t.key === param(sp, "status"))?.key ?? "";
  const tab = TABS.find((t) => t.key === key)!;
  const q = param(sp, "q").slice(0, 100);
  const page = pageParam(sp);
  const search: Prisma.PaymentWhereInput = q
    ? {
        OR: [
          { reference: { contains: q, mode: "insensitive" } },
          { stripePaymentIntentId: { contains: q } },
          { invoice: { number: { contains: q, mode: "insensitive" } } },
          { invoice: { customerName: { contains: q, mode: "insensitive" } } },
          { order: { number: { contains: q, mode: "insensitive" } } },
        ],
      }
    : {};
  const where: Prisma.PaymentWhereInput = { AND: [search, tab.where ?? {}] };
  const [rows, total, counts, sum] = await Promise.all([
    prisma.payment.findMany({ where, orderBy: { receivedAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { invoice: { select: { id: true, number: true, customerName: true } }, order: { select: { id: true, number: true } } } }),
    prisma.payment.count({ where }),
    Promise.all(TABS.map((t) => prisma.payment.count({ where: { AND: [search, t.where ?? {}] } }))),
    prisma.payment.aggregate({ where: { AND: [where, { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] } }] }, _sum: { amountCents: true, refundedCents: true } }),
  ]);
  const net = (sum._sum.amountCents ?? 0) - (sum._sum.refundedCents ?? 0);
  return (
    <>
      <PageHeader title="Payments" description={`Every payment received, online and offline. Net received in this view: ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(net / 100)}.`} />
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <FilterTabs active={key} tabs={TABS.map((t, i) => ({ key: t.key, label: t.label, count: counts[i], href: listHref(BASE, { status: t.key, q }) }))} />
        <SearchBox action={BASE} q={q} placeholder="Invoice, order, customer or reference" hidden={{ status: key }} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No payments" description={q || key ? "Try a different search or filter." : "Payments recorded on invoices appear here."} />
      ) : (
        <>
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.thead}>
                <tr>
                  <th scope="col" className={table.th}>Received</th>
                  <th scope="col" className={table.th}>Customer</th>
                  <th scope="col" className={table.th}>Invoice</th>
                  <th scope="col" className={table.th}>Method</th>
                  <th scope="col" className={cn(table.th, "text-right")}>Amount</th>
                  <th scope="col" className={table.th}>Status</th>
                </tr>
              </thead>
              <tbody className={table.tbody}>
                {rows.map((p) => (
                  <tr key={p.id} className={table.tr}>
                    <td className={cn(table.td, "whitespace-nowrap")}>{formatDate(p.receivedAt)}</td>
                    <td className={table.td}>{p.invoice?.customerName ?? "—"}</td>
                    <td className={cn(table.td, "whitespace-nowrap")}>
                      {p.invoice ? (
                        <Link href={`/admin/invoices/${p.invoice.id}`} className="inline-block py-1 font-mono text-xs underline underline-offset-2">
                          {p.invoice.number}
                        </Link>
                      ) : (
                        "—"
                      )}
                      {p.order ? <p className="font-mono text-xs text-neutral-500">{p.order.number}</p> : null}
                    </td>
                    <td className={table.td}>
                      {PAYMENT_METHOD_LABELS[p.method as PaymentMethod]}
                      {p.reference ? <p className="text-xs text-neutral-500">{p.reference}</p> : null}
                    </td>
                    <td className={cn(table.td, "text-right")}>
                      <Money cents={p.amountCents} />
                      {p.refundedCents ? <p className="text-xs text-red-700">−<Money cents={p.refundedCents} /></p> : null}
                    </td>
                    <td className={table.td}>
                      <SalesBadge status={p.status} />
                    </td>
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
