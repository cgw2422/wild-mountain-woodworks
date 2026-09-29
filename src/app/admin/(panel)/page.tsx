import type { Metadata } from "next";
import Link from "next/link";
import type { CustomRequestStatus, QuoteStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { getSampleContentSummary } from "@/lib/admin/sample-content";
import { AdminLinkButton, Card, PageHeader, Stat, StatusBadge, formatDate } from "@/components/admin/ui";
import { RelativeTime } from "@/components/admin/inbox/time";
import { RemoveSampleContent } from "@/components/admin/dashboard/RemoveSampleContent";
import { removeSampleContentAction } from "@/components/admin/dashboard/actions";

export const metadata: Metadata = { title: "Dashboard" };

const OPEN_QUOTES: QuoteStatus[] = ["NEW", "CONTACTED", "QUOTED"];
const CLOSED_CUSTOM: CustomRequestStatus[] = ["DECLINED", "COMPLETED"];

/** Link to the entity an activity row refers to, when it can still exist. */
function activityHref(a: { type: string; entityType: string | null; entityId: string | null }): string | null {
  if (!a.entityId || !a.entityType || a.type.endsWith(".deleted")) return null;
  const base: Record<string, string> = {
    quote: "/admin/quotes",
    custom_request: "/admin/custom-requests",
    message: "/admin/messages",
    product: "/admin/products",
    media: "/admin/media",
    order: "/admin/orders",
  };
  return base[a.entityType] ? `${base[a.entityType]}/${a.entityId}` : null;
}

function ChecklistItem({ ok, title, children }: { ok: boolean; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3 py-3">
      <span
        className={cn(
          "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800",
        )}
      >
        <span aria-hidden="true">{ok ? "✓" : "!"}</span>
        <span className="sr-only">{ok ? "Done:" : "To do:"}</span>
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className={cn("font-medium", ok ? "text-neutral-600" : "text-neutral-900")}>{title}</p>
        {children ? <div className="mt-1 text-neutral-600">{children}</div> : null}
      </div>
    </li>
  );
}

const linkCls = "font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-600";

export default async function DashboardPage() {
  const [
    settings,
    activeProducts,
    draftProducts,
    newQuotes,
    openQuotes,
    openCustom,
    unreadMessages,
    activity,
    recentQuotes,
    recentCustom,
    reviewPages,
    missingAlt,
    sample,
  ] = await Promise.all([
    getSettings(),
    prisma.product.count({ where: { status: "ACTIVE" } }),
    prisma.product.count({ where: { status: "DRAFT" } }),
    prisma.quoteRequest.count({ where: { status: "NEW" } }),
    prisma.quoteRequest.count({ where: { status: { in: OPEN_QUOTES } } }),
    prisma.customRequest.count({ where: { status: { notIn: CLOSED_CUSTOM } } }),
    prisma.contactMessage.count({ where: { status: "UNREAD" } }),
    prisma.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 15, include: { actor: { select: { name: true } } } }),
    prisma.quoteRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, reference: true, name: true, productName: true, source: true, estimatedTotalCents: true, status: true, readAt: true, createdAt: true },
    }),
    prisma.customRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, reference: true, name: true, furnitureType: true, status: true, readAt: true, createdAt: true },
    }),
    prisma.page.findMany({ where: { reviewRequired: true }, orderBy: { title: "asc" }, select: { slug: true, title: true } }),
    prisma.media.count({ where: { alt: "" } }),
    getSampleContentSummary(),
  ]);

  const hasSample = sample.products + sample.portfolio + sample.media > 0;
  const checklist = [
    Boolean(settings.email?.trim()),
    Boolean(settings.phone?.trim()),
    Boolean(settings.notificationEmail?.trim()),
    reviewPages.length === 0,
    missingAlt === 0,
    !hasSample,
  ];
  const remaining = checklist.filter((ok) => !ok).length;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Welcome back. Here's what needs attention at ${settings.businessName}.`}
        actions={
          <>
            <AdminLinkButton href="/admin/products/new" variant="primary">
              Add product
            </AdminLinkButton>
            <AdminLinkButton href="/admin/pricing-calculator">Pricing calculator</AdminLinkButton>
            <AdminLinkButton href="/admin/media">Upload images</AdminLinkButton>
            <AdminLinkButton href="/admin/homepage">Edit homepage</AdminLinkButton>
          </>
        }
      />

      <section aria-labelledby="dash-stats" className="mb-8">
        <h2 id="dash-stats" className="sr-only">
          At a glance
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Active products" value={activeProducts} href="/admin/products?status=active" />
          <Stat label="Draft products" value={draftProducts} href="/admin/products?status=draft" />
          <Stat label="New quote requests" value={newQuotes} href="/admin/quotes?status=NEW" />
          <Stat label="Open quotes" value={openQuotes} href="/admin/quotes?status=open" hint="New, contacted or quoted" />
          <Stat label="Open custom requests" value={openCustom} href="/admin/custom-requests?status=open" hint="Not declined or completed" />
          <Stat label="Unread messages" value={unreadMessages} href="/admin/messages?status=unread" />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <Card
              title="Recent quote requests"
              className="min-w-0"
              actions={
                <Link href="/admin/quotes" className="inline-block py-1 text-sm font-medium text-neutral-600 hover:text-neutral-900 hover:underline">
                  View all
                </Link>
              }
              bodyClassName="p-0"
            >
              {recentQuotes.length === 0 ? (
                <p className="px-5 py-6 text-sm text-neutral-500">No quote requests yet. They&apos;ll appear here as soon as customers submit them.</p>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {recentQuotes.map((q) => (
                    <li key={q.id}>
                      <Link href={`/admin/quotes/${q.id}`} className="flex items-start justify-between gap-3 px-5 py-3 hover:bg-neutral-50">
                        <span className="min-w-0">
                          <span className={cn("block truncate text-sm", q.readAt ? "font-medium" : "font-bold")}>
                            {q.name}
                            {!q.readAt ? <span className="sr-only"> (unread)</span> : null}
                          </span>
                          <span className="block truncate text-xs text-neutral-500">
                            <span className="font-mono">{q.reference}</span> · {q.source === "GENERAL" ? "General request" : (q.productName ?? "—")}
                            {q.estimatedTotalCents != null ? ` · ${formatCents(q.estimatedTotalCents)}` : ""}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <StatusBadge status={q.status} />
                          <span className="text-xs text-neutral-500">{formatDate(q.createdAt)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Recent custom requests"
              className="min-w-0"
              actions={
                <Link href="/admin/custom-requests" className="inline-block py-1 text-sm font-medium text-neutral-600 hover:text-neutral-900 hover:underline">
                  View all
                </Link>
              }
              bodyClassName="p-0"
            >
              {recentCustom.length === 0 ? (
                <p className="px-5 py-6 text-sm text-neutral-500">No custom build requests yet.</p>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {recentCustom.map((r) => (
                    <li key={r.id}>
                      <Link href={`/admin/custom-requests/${r.id}`} className="flex items-start justify-between gap-3 px-5 py-3 hover:bg-neutral-50">
                        <span className="min-w-0">
                          <span className={cn("block truncate text-sm", r.readAt ? "font-medium" : "font-bold")}>
                            {r.name}
                            {!r.readAt ? <span className="sr-only"> (unread)</span> : null}
                          </span>
                          <span className="block truncate text-xs text-neutral-500">
                            <span className="font-mono">{r.reference}</span> · {r.furnitureType}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <StatusBadge status={r.status} />
                          <span className="text-xs text-neutral-500">{formatDate(r.createdAt)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Recent activity" bodyClassName="p-0">
            {activity.length === 0 ? (
              <p className="px-5 py-6 text-sm text-neutral-500">No activity yet. Edits, new requests and status changes will be listed here.</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {activity.map((a) => {
                  const href = activityHref(a);
                  return (
                    <li key={a.id} className="flex items-start justify-between gap-4 px-5 py-3 text-sm">
                      <div className="min-w-0">
                        {href ? (
                          <Link href={href} className="text-neutral-900 hover:underline [overflow-wrap:anywhere]">
                            {a.message}
                          </Link>
                        ) : (
                          <p className="text-neutral-900 [overflow-wrap:anywhere]">{a.message}</p>
                        )}
                        <p className="mt-0.5 text-xs text-neutral-500">{a.actor?.name ?? (a.type.endsWith(".received") ? "Website" : "System")}</p>
                      </div>
                      <RelativeTime date={a.createdAt} className="shrink-0 whitespace-nowrap text-xs text-neutral-500" />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card
            title="Launch checklist"
            description={remaining === 0 ? "Everything is ready for launch." : `${remaining} item${remaining === 1 ? "" : "s"} left before launch.`}
          >
            <ul className="-my-3 divide-y divide-neutral-100">
              <ChecklistItem ok={checklist[0]} title="Contact email set">
                {!checklist[0] ? (
                  <>
                    Shown on the Contact page and footer.{" "}
                    <Link href="/admin/settings" className={linkCls}>
                      Add it in Settings
                    </Link>
                  </>
                ) : null}
              </ChecklistItem>
              <ChecklistItem ok={checklist[1]} title="Phone number set">
                {!checklist[1] ? (
                  <Link href="/admin/settings" className={linkCls}>
                    Add it in Settings
                  </Link>
                ) : null}
              </ChecklistItem>
              <ChecklistItem ok={checklist[2]} title="Notification email set">
                {!checklist[2] ? (
                  <>
                    Where new quote requests and messages are emailed.{" "}
                    <Link href="/admin/settings" className={linkCls}>
                      Add it in Settings
                    </Link>
                  </>
                ) : null}
              </ChecklistItem>
              <ChecklistItem
                ok={checklist[3]}
                title={checklist[3] ? "Policy pages reviewed" : `${reviewPages.length} page${reviewPages.length === 1 ? "" : "s"} need${reviewPages.length === 1 ? "s" : ""} review`}
              >
                {reviewPages.length ? (
                  <>
                    <p>Draft policy wording should be reviewed by the owner (and legal advisor) before launch:</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {reviewPages.map((p) => (
                        <li key={p.slug}>
                          <Link href={`/admin/pages/${p.slug}`} className={linkCls}>
                            {p.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </ChecklistItem>
              <ChecklistItem ok={checklist[4]} title={checklist[4] ? "All images have alt text" : `${missingAlt} image${missingAlt === 1 ? "" : "s"} missing alt text`}>
                {missingAlt ? (
                  <>
                    Alt text helps screen-reader users and search engines.{" "}
                    <Link href="/admin/media?filter=noalt" className={linkCls}>
                      Review images
                    </Link>
                  </>
                ) : null}
              </ChecklistItem>
              <ChecklistItem ok={checklist[5]} title={checklist[5] ? "Sample content removed" : "Sample content is still on the site"}>
                {hasSample ? (
                  <div className="space-y-2">
                    <p>
                      {sample.products} sample product{sample.products === 1 ? "" : "s"}, {sample.portfolio} portfolio project
                      {sample.portfolio === 1 ? "" : "s"} and{" "}
                      <Link href="/admin/media?filter=sample" className={linkCls}>
                        {sample.media} sample image{sample.media === 1 ? "" : "s"}
                      </Link>
                      .
                    </p>
                    <RemoveSampleContent action={removeSampleContentAction} summary={sample} />
                  </div>
                ) : null}
              </ChecklistItem>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
