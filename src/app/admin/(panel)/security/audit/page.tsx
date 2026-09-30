import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { Badge, EmptyState, PageHeader, formatDate, table } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const SECURITY_PREFIXES = ["admin.", "account."];

type SP = Promise<{ view?: string; q?: string; page?: string }>;

/** Owner-only record of admin activity: sign-ins, security changes, and every content/catalog/quote change. */
export default async function AuditLogPage({ searchParams }: { searchParams: SP }) {
  await requireOwner();
  const sp = await searchParams;
  const view = sp.view === "security" || sp.view === "failed" ? sp.view : "all";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Math.min(1000, Number(sp.page) || 1));

  const where: Prisma.ActivityLogWhereInput = {
    ...(view === "security" ? { OR: SECURITY_PREFIXES.map((p) => ({ type: { startsWith: p } })) } : {}),
    ...(view === "failed" ? { type: { in: ["admin.login_failed", "admin.mfa_failed", "admin.login_locked"] } } : {}),
    ...(q
      ? {
          AND: [
            {
              OR: [
                { message: { contains: q, mode: "insensitive" } },
                { type: { contains: q, mode: "insensitive" } },
                { ipAddress: { contains: q } },
                { actor: { name: { contains: q, mode: "insensitive" } } },
              ],
            },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.activityLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { actor: { select: { name: true, email: true } } } }),
    prisma.activityLog.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (over: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { view, q, page: 1, ...over };
    if (merged.view !== "all") params.set("view", String(merged.view));
    if (merged.q) params.set("q", String(merged.q));
    if (Number(merged.page) > 1) params.set("page", String(merged.page));
    const s = params.toString();
    return `/admin/security/audit${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        breadcrumbs={[{ label: "Security", href: "/admin/security" }, { label: "Audit log" }]}
        description="Who did what, when and from where. Passwords, codes and other secrets are never recorded."
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 text-sm" aria-label="Filter">
          {[
            ["all", "Everything"],
            ["security", "Security"],
            ["failed", "Failed sign-ins"],
          ].map(([v, label]) => (
            <Link key={v} href={href({ view: v })} className={cn("rounded px-3 py-1.5", view === v ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")}>
              {label}
            </Link>
          ))}
        </nav>
        <form className="flex gap-2" action="/admin/security/audit">
          {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
          <label htmlFor="audit-q" className="sr-only">
            Search the audit log
          </label>
          <input id="audit-q" name="q" defaultValue={q} placeholder="Search name, event, IP…" className="h-9 w-56 rounded border border-neutral-300 px-2 text-sm" />
          <button type="submit" className="h-9 rounded border border-neutral-300 bg-white px-3 text-sm">
            Search
          </button>
        </form>
      </div>

      {rows.length ? (
        <div className={table.wrap}>
          <table className={table.table}>
            <thead className={table.thead}>
              <tr>
                <th scope="col" className={table.th}>When</th>
                <th scope="col" className={table.th}>Who</th>
                <th scope="col" className={table.th}>Event</th>
                <th scope="col" className={table.th}>Origin</th>
              </tr>
            </thead>
            <tbody className={table.tbody}>
              {rows.map((r) => {
                const failed = /failed|locked/.test(r.type);
                return (
                  <tr key={r.id} className={table.tr}>
                    <td className={cn(table.td, "whitespace-nowrap text-xs")}>{formatDate(r.createdAt, true)}</td>
                    <td className={cn(table.td, "text-sm")}>{r.actor ? r.actor.name : <span className="text-neutral-400">—</span>}</td>
                    <td className={table.td}>
                      <Badge tone={failed ? "red" : r.type.startsWith("admin.") || r.type.startsWith("account.") ? "violet" : "neutral"}>{r.type}</Badge>
                      <p className="mt-1 text-sm text-neutral-800 [overflow-wrap:anywhere]">{r.message}</p>
                    </td>
                    <td className={cn(table.td, "text-xs text-neutral-600")}>
                      {r.ipAddress ?? "—"}
                      {r.userAgent ? <span className="block max-w-[16rem] truncate text-neutral-400" title={r.userAgent}>{r.userAgent}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="Nothing found" description={q ? "No events match that search." : "No events recorded yet."} />
      )}

      {pages > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
          <span className="text-neutral-500">
            Page {page} of {pages} · {total} events
          </span>
          <span className="flex gap-2">
            {page > 1 ? <Link className="rounded border border-neutral-300 px-3 py-1.5" href={href({ page: page - 1 })}>Newer</Link> : null}
            {page < pages ? <Link className="rounded border border-neutral-300 px-3 py-1.5" href={href({ page: page + 1 })}>Older</Link> : null}
          </span>
        </nav>
      ) : null}
    </>
  );
}
