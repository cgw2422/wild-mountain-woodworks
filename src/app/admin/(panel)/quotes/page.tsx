import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma, QuoteStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { expireDueQuotes } from "@/lib/sales/quotes";
import { EmptyState, PageHeader, adminButton, formatDate, table } from "@/components/admin/ui";
import { FilterTabs, PAGE_SIZE, Pagination, SearchBox, listHref, pageParam, param } from "@/components/admin/inbox/ListControls";
import { Money } from "@/components/admin/sales/Money";
import { SalesBadge } from "@/components/admin/sales/SalesBadge";

export const metadata: Metadata = { title: "Quotes" };

const BASE = "/admin/quotes";
const TABS: Array<{ key: string; label: string; statuses?: QuoteStatus[]; archived?: boolean }> = [
  { key: "", label: "All" },
  { key: "action", label: "Needs action", statuses: ["NEW", "REVIEWING", "DRAFT"] },
  { key: "waiting", label: "Waiting on customer", statuses: ["SENT", "VIEWED"] },
  { key: "accepted", label: "Accepted", statuses: ["ACCEPTED", "CONVERTED_TO_INVOICE"] },
  { key: "declined", label: "Declined", statuses: ["DECLINED"] },
  { key: "expired", label: "Expired", statuses: ["EXPIRED"] },
  { key: "closed", label: "Completed / canceled", statuses: ["COMPLETED", "CANCELED"] },
  { key: "archived", label: "Archived", archived: true },
];

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("sales");
  await expireDueQuotes();
  const sp = await searchParams;
  const statusKey = TABS.find((t) => t.key === param(sp, "status"))?.key ?? "";
  const tab = TABS.find((t) => t.key === statusKey)!;
  const q = param(sp, "q").slice(0, 100);
  const page = pageParam(sp);

  const search: Prisma.QuoteRequestWhereInput = q
    ? {
        OR: [
          { number: { contains: q, mode: "insensitive" } },
          { reference: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
          { productName: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};
  const archivedWhere: Prisma.QuoteRequestWhereInput = tab.archived ? { archivedAt: { not: null } } : { archivedAt: null };
  const where: Prisma.QuoteRequestWhereInput = { ...search, ...archivedWhere, ...(tab.statuses ? { status: { in: tab.statuses } } : {}) };

  const [rows, total, grouped, archivedCount] = await Promise.all([
    prisma.quoteRequest.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        number: true,
        reference: true,
        name: true,
        email: true,
        productName: true,
        source: true,
        quantity: true,
        estimatedTotalCents: true,
        status: true,
        readAt: true,
        createdAt: true,
        currentRevision: { select: { number: true, totalCents: true, status: true } },
        revisions: { where: { status: { in: ["SENT", "ACCEPTED", "DECLINED"] } }, select: { expiresAt: true }, orderBy: { number: "desc" }, take: 1 },
      },
    }),
    prisma.quoteRequest.count({ where }),
    prisma.quoteRequest.groupBy({ by: ["status"], where: { ...search, archivedAt: null }, _count: true }),
    prisma.quoteRequest.count({ where: { ...search, archivedAt: { not: null } } }),
  ]);
  const countFor = (t: (typeof TABS)[number]) =>
    t.archived ? archivedCount : grouped.filter((g) => !t.statuses || t.statuses.includes(g.status)).reduce((sum, g) => sum + g._count, 0);
  const hrefFor = (params: { status?: string; page?: number }) => listHref(BASE, { status: statusKey, q, ...params });

  return (
    <>
      <PageHeader
        title="Quotes"
        description="Every request becomes a quote you price, send and track here. Customers accept online; accepted quotes become orders."
        actions={
          <Link href={`${BASE}/new`} className={adminButton.primary}>
            New quote
          </Link>
        }
      />
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <FilterTabs active={statusKey} tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: countFor(t), href: listHref(BASE, { status: t.key, q }) }))} />
        <SearchBox action={BASE} q={q} placeholder="Number, name, email, phone or product" hidden={{ status: statusKey }} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={q || statusKey ? "No matching quotes" : "No quotes yet"}
          description={q || statusKey ? "Try a different search or filter." : "When customers request a quote from a product page or the quote form, it appears here. You can also create one yourself."}
          action={
            q || statusKey ? (
              <Link href={BASE} className="text-sm font-medium underline underline-offset-2">
                Show all quotes
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.thead}>
                <tr>
                  <th scope="col" className={table.th}>Quote</th>
                  <th scope="col" className={table.th}>Customer</th>
                  <th scope="col" className={table.th}>For</th>
                  <th scope="col" className={cn(table.th, "text-right")}>Total</th>
                  <th scope="col" className={table.th}>Received</th>
                  <th scope="col" className={table.th}>Expires</th>
                  <th scope="col" className={table.th}>Status</th>
                </tr>
              </thead>
              <tbody className={table.tbody}>
                {rows.map((r) => {
                  const unread = !r.readAt;
                  const total = r.currentRevision?.totalCents || r.estimatedTotalCents;
                  const expires = r.revisions[0]?.expiresAt;
                  return (
                    <tr key={r.id} className={cn(table.tr, unread && "bg-sky-50/40")}>
                      <td className={cn(table.td, "whitespace-nowrap")}>
                        <Link href={`${BASE}/${r.id}`} className={cn("inline-block py-1 font-mono text-xs hover:underline", unread ? "font-bold text-neutral-900" : "text-neutral-700")}>
                          {unread ? <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-sky-600 align-middle" aria-hidden="true" /> : null}
                          {r.number ?? r.reference}
                          {unread ? <span className="sr-only"> (new)</span> : null}
                        </Link>
                        {r.currentRevision && r.currentRevision.number > 1 ? <p className="text-xs text-neutral-500">Rev {r.currentRevision.number}</p> : null}
                      </td>
                      <td className={table.td}>
                        <p className={cn(unread ? "font-semibold" : "font-medium")}>{r.name}</p>
                        <p className="text-xs text-neutral-500">{r.email}</p>
                      </td>
                      <td className={table.td}>
                        {r.productName ?? <span className="text-neutral-500">{r.source === "MANUAL" ? "Manual quote" : "General request"}</span>}
                        {r.quantity > 1 ? <span className="text-neutral-500"> × {r.quantity}</span> : null}
                      </td>
                      <td className={cn(table.td, "whitespace-nowrap text-right")}>
                        <Money cents={total ?? null} />
                      </td>
                      <td className={cn(table.td, "whitespace-nowrap text-neutral-600")}>{formatDate(r.createdAt)}</td>
                      <td className={cn(table.td, "whitespace-nowrap text-neutral-600")}>{expires ? formatDate(new Date(expires.getTime() - 1)) : "—"}</td>
                      <td className={table.td}>
                        <SalesBadge status={r.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} href={(p) => hrefFor({ page: p })} />
        </>
      )}
    </>
  );
}
