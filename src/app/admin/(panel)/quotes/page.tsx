import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import Link from "next/link";
import type { Prisma, QuoteStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/cn";
import { EmptyState, PageHeader, StatusBadge, formatDate, table } from "@/components/admin/ui";
import { FilterTabs, PAGE_SIZE, Pagination, SearchBox, listHref, pageParam, param } from "@/components/admin/inbox/ListControls";

export const metadata: Metadata = { title: "Quotes" };

const BASE = "/admin/quotes";
const OPEN: QuoteStatus[] = ["NEW", "CONTACTED", "QUOTED"];
const TABS: Array<{ key: string; label: string; statuses?: QuoteStatus[] }> = [
  { key: "", label: "All" },
  { key: "open", label: "Open", statuses: OPEN },
  { key: "NEW", label: "New", statuses: ["NEW"] },
  { key: "CONTACTED", label: "Contacted", statuses: ["CONTACTED"] },
  { key: "QUOTED", label: "Quoted", statuses: ["QUOTED"] },
  { key: "ACCEPTED", label: "Accepted", statuses: ["ACCEPTED"] },
  { key: "DECLINED", label: "Declined", statuses: ["DECLINED"] },
  { key: "COMPLETED", label: "Completed", statuses: ["COMPLETED"] },
];

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const statusKey = TABS.find((t) => t.key === param(sp, "status"))?.key ?? "";
  const tab = TABS.find((t) => t.key === statusKey)!;
  const q = param(sp, "q").slice(0, 100);
  const page = pageParam(sp);

  const search: Prisma.QuoteRequestWhereInput = q
    ? {
        OR: [
          { reference: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { productName: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};
  const where: Prisma.QuoteRequestWhereInput = { ...search, ...(tab.statuses ? { status: { in: tab.statuses } } : {}) };

  const [rows, total, grouped] = await Promise.all([
    prisma.quoteRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        reference: true,
        name: true,
        email: true,
        productName: true,
        source: true,
        estimatedTotalCents: true,
        status: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.quoteRequest.count({ where }),
    prisma.quoteRequest.groupBy({ by: ["status"], where: search, _count: true }),
  ]);
  const countFor = (statuses?: QuoteStatus[]) =>
    grouped.filter((g) => !statuses || statuses.includes(g.status)).reduce((sum, g) => sum + g._count, 0);
  const hrefFor = (params: { status?: string; page?: number }) => listHref(BASE, { status: statusKey, q, ...params });

  return (
    <>
      <PageHeader title="Quote requests" description="Requests from the product configurator and the general quote form." />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterTabs
          active={statusKey}
          tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: countFor(t.statuses), href: listHref(BASE, { status: t.key, q }) }))}
        />
        <SearchBox action={BASE} q={q} placeholder="Reference, name, email or product" hidden={{ status: statusKey }} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={q || statusKey ? "No matching quote requests" : "No quote requests yet"}
          description={
            q || statusKey
              ? "Try a different search or status filter."
              : "When customers request a quote from a product page or the quote form, it will appear here."
          }
          action={
            q || statusKey ? (
              <Link href={BASE} className="text-sm font-medium underline underline-offset-2">
                Show all quote requests
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
                  <th scope="col" className={table.th}>Reference</th>
                  <th scope="col" className={table.th}>Customer</th>
                  <th scope="col" className={table.th}>Product</th>
                  <th scope="col" className={cn(table.th, "text-right")}>Estimate</th>
                  <th scope="col" className={table.th}>Date</th>
                  <th scope="col" className={table.th}>Status</th>
                </tr>
              </thead>
              <tbody className={table.tbody}>
                {rows.map((r) => {
                  const unread = !r.readAt;
                  return (
                    <tr key={r.id} className={cn(table.tr, unread && "bg-sky-50/40")}>
                      <td className={cn(table.td, "whitespace-nowrap")}>
                        <Link href={`${BASE}/${r.id}`} className={cn("font-mono text-xs hover:underline", unread ? "font-bold text-neutral-900" : "text-neutral-700")}>
                          {unread ? <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-sky-600 align-middle" aria-hidden="true" /> : null}
                          {r.reference}
                          {unread ? <span className="sr-only"> (unread)</span> : null}
                        </Link>
                      </td>
                      <td className={table.td}>
                        <p className={cn(unread ? "font-semibold" : "font-medium")}>{r.name}</p>
                        <p className="text-xs text-neutral-500">{r.email}</p>
                      </td>
                      <td className={table.td}>
                        {r.source === "GENERAL" ? <span className="text-neutral-500">General request</span> : (r.productName ?? "—")}
                      </td>
                      <td className={cn(table.td, "whitespace-nowrap text-right tabular-nums")}>
                        {r.estimatedTotalCents != null ? formatCents(r.estimatedTotalCents) : <span className="text-neutral-400">—</span>}
                      </td>
                      <td className={cn(table.td, "whitespace-nowrap text-neutral-600")}>{formatDate(r.createdAt)}</td>
                      <td className={table.td}>
                        <StatusBadge status={r.status} />
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
