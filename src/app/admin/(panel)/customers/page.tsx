import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { EmptyState, PageHeader, formatDate, table } from "@/components/admin/ui";
import { PAGE_SIZE, Pagination, SearchBox, listHref, pageParam, param } from "@/components/admin/inbox/ListControls";

export const metadata: Metadata = { title: "Customers" };

const BASE = "/admin/customers";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("sales");
  const sp = await searchParams;
  const q = param(sp, "q").slice(0, 100);
  const page = pageParam(sp);
  const where: Prisma.CustomerWhereInput = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { zipCode: { contains: q } }] }
    : {};
  const [rows, total] = await Promise.all([
    prisma.customer.findMany({ where, orderBy: { lastActivityAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { _count: { select: { quotes: true, orders: true } } } }),
    prisma.customer.count({ where }),
  ]);
  return (
    <>
      <PageHeader title="Customers" description="Created automatically from quote requests, matched by exact email address. Customers never need an account." />
      <div className="mb-4 flex justify-end">
        <SearchBox action={BASE} q={q} placeholder="Name, email, phone or ZIP" />
      </div>
      {rows.length === 0 ? (
        <EmptyState title={q ? "No matching customers" : "No customers yet"} description={q ? "Try a different search." : "Customers are added when someone requests a quote."} />
      ) : (
        <>
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.thead}>
                <tr>
                  <th scope="col" className={table.th}>Customer</th>
                  <th scope="col" className={table.th}>Phone</th>
                  <th scope="col" className={table.th}>Quotes</th>
                  <th scope="col" className={table.th}>Orders</th>
                  <th scope="col" className={table.th}>Last activity</th>
                </tr>
              </thead>
              <tbody className={table.tbody}>
                {rows.map((c) => (
                  <tr key={c.id} className={table.tr}>
                    <td className={table.td}>
                      <Link href={`${BASE}/${c.id}`} className="inline-block py-1 font-medium hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-neutral-500">{c.email}</p>
                    </td>
                    <td className={table.td}>{c.phone ?? "—"}</td>
                    <td className={table.td}>{c._count.quotes}</td>
                    <td className={table.td}>{c._count.orders}</td>
                    <td className={table.td}>{formatDate(c.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} href={(p) => listHref(BASE, { q, page: p })} />
        </>
      )}
    </>
  );
}
