import type { Metadata } from "next";
import Link from "next/link";
import type { MessageStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/cn";
import { EmptyState, PageHeader, StatusBadge, formatDate, table } from "@/components/admin/ui";
import { FilterTabs, PAGE_SIZE, Pagination, SearchBox, listHref, pageParam, param } from "@/components/admin/inbox/ListControls";
import { contactReasonLabel } from "@/components/admin/inbox/kinds";

export const metadata: Metadata = { title: "Messages" };

const BASE = "/admin/messages";
const TABS: Array<{ key: string; label: string; statuses: MessageStatus[] }> = [
  { key: "unread", label: "Unread", statuses: ["UNREAD"] },
  { key: "read", label: "Read", statuses: ["READ"] },
  { key: "replied", label: "Replied", statuses: ["REPLIED"] },
  { key: "archived", label: "Archived", statuses: ["ARCHIVED"] },
  // Default view: everything that isn't archived.
  { key: "", label: "All", statuses: ["UNREAD", "READ", "REPLIED"] },
];

function preview(text: string, max = 110) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const statusKey = TABS.find((t) => t.key === param(sp, "status").toLowerCase())?.key ?? "";
  const tab = TABS.find((t) => t.key === statusKey)!;
  const q = param(sp, "q").slice(0, 100);
  const page = pageParam(sp);

  const search: Prisma.ContactMessageWhereInput = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { message: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};
  const where: Prisma.ContactMessageWhereInput = { ...search, status: { in: tab.statuses } };

  const [rows, total, grouped] = await Promise.all([
    prisma.contactMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, name: true, email: true, reason: true, message: true, status: true, createdAt: true },
    }),
    prisma.contactMessage.count({ where }),
    prisma.contactMessage.groupBy({ by: ["status"], where: search, _count: true }),
  ]);
  const countFor = (statuses: MessageStatus[]) => grouped.filter((g) => statuses.includes(g.status)).reduce((sum, g) => sum + g._count, 0);

  return (
    <>
      <PageHeader title="Messages" description="Messages sent through the contact form. “All” excludes archived messages." />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterTabs
          active={statusKey}
          tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: countFor(t.statuses), href: listHref(BASE, { status: t.key, q }) }))}
        />
        <SearchBox action={BASE} q={q} placeholder="Name, email or message text" hidden={{ status: statusKey }} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={q || statusKey ? "No matching messages" : "No messages yet"}
          description={q || statusKey ? "Try a different search or filter." : "Messages sent from the Contact page will appear here."}
          action={
            q || statusKey ? (
              <Link href={BASE} className="text-sm font-medium underline underline-offset-2">
                Show all messages
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
                  <th scope="col" className={table.th}>From</th>
                  <th scope="col" className={table.th}>Reason</th>
                  <th scope="col" className={table.th}>Message</th>
                  <th scope="col" className={table.th}>Date</th>
                  <th scope="col" className={table.th}>Status</th>
                </tr>
              </thead>
              <tbody className={table.tbody}>
                {rows.map((r) => {
                  const unread = r.status === "UNREAD";
                  return (
                    <tr key={r.id} className={cn(table.tr, unread && "bg-sky-50/40")}>
                      <td className={table.td}>
                        <Link href={`${BASE}/${r.id}`} className={cn("hover:underline", unread ? "font-bold text-neutral-900" : "font-medium")}>
                          {unread ? <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-sky-600 align-middle" aria-hidden="true" /> : null}
                          {r.name}
                          {unread ? <span className="sr-only"> (unread)</span> : null}
                        </Link>
                        <p className="text-xs text-neutral-500">{r.email}</p>
                      </td>
                      <td className={cn(table.td, "whitespace-nowrap")}>{contactReasonLabel(r.reason)}</td>
                      <td className={cn(table.td, "min-w-64 max-w-md text-neutral-600", unread && "text-neutral-900")}>{preview(r.message)}</td>
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
          <Pagination page={page} total={total} href={(p) => listHref(BASE, { status: statusKey, q, page: p })} />
        </>
      )}
    </>
  );
}
