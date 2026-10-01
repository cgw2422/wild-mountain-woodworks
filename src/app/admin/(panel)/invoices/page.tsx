import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { markPastDueInvoices } from "@/lib/sales/ledger";
import { INVOICE_KIND_LABELS } from "@/lib/sales/status";
import { INVOICE_TABS, invoiceListWhere } from "@/lib/sales/list-filters";
import { EmptyState, PageHeader, formatDate, table } from "@/components/admin/ui";
import { FilterTabs, PAGE_SIZE, Pagination, SearchBox, listHref, pageParam, param } from "@/components/admin/inbox/ListControls";
import { Money } from "@/components/admin/sales/Money";
import { SalesBadge } from "@/components/admin/sales/SalesBadge";

export const metadata: Metadata = { title: "Invoices" };

const BASE = "/admin/invoices";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("finance");
  await markPastDueInvoices();
  const sp = await searchParams;
  const key = INVOICE_TABS.find((t) => t.key === param(sp, "status"))?.key ?? "";
  const q = param(sp, "q").slice(0, 100);
  const page = pageParam(sp);
  const where = invoiceListWhere(key, q);
  const [rows, total, counts] = await Promise.all([
    prisma.invoice.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { order: { select: { number: true } } } }),
    prisma.invoice.count({ where }),
    Promise.all(INVOICE_TABS.map((t) => prisma.invoice.count({ where: invoiceListWhere(t.key, q) }))),
  ]);
  return (
    <>
      <PageHeader title="Invoices" description="Deposit, balance and custom invoices. Paid online through Stripe (when enabled) or recorded manually. Invoices are never deleted — void them instead (they stay under Voided and in search)." />
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <FilterTabs active={key} tabs={INVOICE_TABS.map((t, i) => ({ key: t.key, label: t.label, count: counts[i], href: listHref(BASE, { status: t.key, q }) }))} />
        <SearchBox action={BASE} q={q} placeholder="Invoice, quote or order number, customer or email" hidden={{ status: key }} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title={q || key ? "No matching invoices" : "No invoices yet"} description={q || key ? "Try a different search or filter." : "A deposit request is created automatically when a customer accepts a quote."} />
      ) : (
        <>
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.thead}>
                <tr>
                  <th scope="col" className={table.th}>Invoice</th>
                  <th scope="col" className={table.th}>Customer</th>
                  <th scope="col" className={table.th}>Type</th>
                  <th scope="col" className={cn(table.th, "text-right")}>Total</th>
                  <th scope="col" className={cn(table.th, "text-right")}>Due</th>
                  <th scope="col" className={table.th}>Due date</th>
                  <th scope="col" className={table.th}>Status</th>
                </tr>
              </thead>
              <tbody className={table.tbody}>
                {rows.map((i) => (
                  <tr key={i.id} className={table.tr}>
                    <td className={cn(table.td, "whitespace-nowrap")}>
                      <Link href={`${BASE}/${i.id}`} className="inline-block py-1 font-mono text-xs font-semibold hover:underline">
                        {i.number}
                      </Link>
                      {i.order ? <p className="text-xs text-neutral-500">{i.order.number}</p> : null}
                    </td>
                    <td className={table.td}>
                      <p className="font-medium">{i.customerName}</p>
                      <p className="text-xs text-neutral-500">{i.customerEmail}</p>
                    </td>
                    <td className={table.td}>
                      {INVOICE_KIND_LABELS[i.kind]}
                      {i.stripeInvoiceId ? <span className="ml-1 text-xs text-neutral-500">(Stripe)</span> : null}
                    </td>
                    <td className={cn(table.td, "text-right")}>
                      <Money cents={i.totalCents} />
                    </td>
                    <td className={cn(table.td, "text-right")}>
                      <Money cents={["VOIDED", "CANCELED"].includes(i.status) ? 0 : i.totalCents - i.amountPaidCents} />
                    </td>
                    <td className={cn(table.td, "whitespace-nowrap")}>{formatDate(i.dueDate)}</td>
                    <td className={table.td}>
                      <SalesBadge status={i.status} />
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
