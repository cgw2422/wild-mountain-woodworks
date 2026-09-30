import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/money";
import { commerceState, getSettings } from "@/lib/settings";
import { Badge, Card, EmptyState, PageHeader, StatusBadge, formatDate, table } from "@/components/admin/ui";
import { PAGE_SIZE, Pagination, listHref, pageParam } from "@/components/admin/inbox/ListControls";
import { PRODUCTION_STATUS_LABELS, statusLabel } from "@/components/admin/inbox/kinds";

export const metadata: Metadata = { title: "Future Orders" };

const BASE = "/admin/orders";

function Condition({ ok, label, detail }: { ok: boolean; label: string; detail: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={cn(
          "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          ok ? "bg-emerald-100 text-emerald-800" : "bg-neutral-200 text-neutral-600",
        )}
        aria-hidden="true"
      >
        {ok ? "✓" : "–"}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-900">
          {label}: <span className={ok ? "text-emerald-700" : "text-neutral-600"}>{ok ? "Yes" : "No"}</span>
        </p>
        <p className="text-xs text-neutral-500">{detail}</p>
      </div>
    </li>
  );
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const page = pageParam(sp);
  const state = commerceState(await getSettings());

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        number: true,
        customerName: true,
        customerEmail: true,
        totalCents: true,
        paymentStatus: true,
        productionStatus: true,
        createdAt: true,
      },
    }),
    prisma.order.count(),
  ]);

  return (
    <>
      <PageHeader
        title="Future Orders"
        description="Online checkout is prepared but switched off. Customers currently request quotes; orders will appear here once checkout is enabled."
      />

      <Card
        title="Online checkout status"
        actions={state.ecommerce ? <Badge tone="green">Checkout live</Badge> : <Badge tone="neutral">Checkout off — quote requests only</Badge>}
        className="mb-6"
      >
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-sm text-neutral-700">Online purchasing only turns on when all three conditions are met:</p>
            <ul className="space-y-3">
              <Condition
                ok={state.ecommerceFlag}
                label="E-commerce switched on in Settings"
                detail={
                  <>
                    Controlled from{" "}
                    <Link href="/admin/settings" className="underline underline-offset-2">
                      Settings
                    </Link>
                    .
                  </>
                }
              />
              <Condition
                ok={state.stripeConfigured}
                label="Stripe keys configured"
                detail="STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY are set on the server."
              />
              <Condition
                ok={state.checkoutUiReady}
                label="Cart & checkout pages released"
                detail="The customer-facing cart and checkout screens are shipped by a developer (CHECKOUT_UI_READY)."
              />
            </ul>
            <p className="mt-4 text-sm text-neutral-600">
              {state.ecommerce
                ? "All conditions are met: products marked purchasable show “Add to Cart”."
                : "Until then, every product shows “Request a Quote” and nothing here is visible to customers."}
            </p>
          </div>
          <div className="text-sm text-neutral-700">
            <h3 className="mb-2 font-semibold text-neutral-900">What enabling checkout involves</h3>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Payment happens on Stripe-hosted Checkout — customers leave the site briefly to pay securely.</li>
              <li>Guest checkout: customers don&apos;t need an account.</li>
              <li>No card details are ever stored here — only Stripe reference IDs.</li>
              <li>Orders are confirmed as paid only by Stripe&apos;s verified webhook, never by the browser.</li>
              <li>Each order keeps an immutable snapshot of the configuration and price that was purchased.</li>
              <li>
                Server environment variables: <code className="rounded bg-neutral-100 px-1 text-xs">STRIPE_SECRET_KEY</code>,{" "}
                <code className="rounded bg-neutral-100 px-1 text-xs">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code>,{" "}
                <code className="rounded bg-neutral-100 px-1 text-xs">STRIPE_WEBHOOK_SECRET</code>.
              </li>
              <li>Taxes, delivery charges and deposits need to be decided before launch.</li>
            </ul>
          </div>
        </div>
      </Card>

      <h2 className="mb-3 text-base font-semibold text-neutral-900">Orders</h2>
      {orders.length === 0 ? (
        <EmptyState title="No orders yet" description="No orders yet — orders will appear here once online checkout is enabled." />
      ) : (
        <>
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.thead}>
                <tr>
                  <th scope="col" className={table.th}>Order</th>
                  <th scope="col" className={table.th}>Customer</th>
                  <th scope="col" className={cn(table.th, "text-right")}>Total</th>
                  <th scope="col" className={table.th}>Payment</th>
                  <th scope="col" className={table.th}>Production</th>
                  <th scope="col" className={table.th}>Date</th>
                </tr>
              </thead>
              <tbody className={table.tbody}>
                {orders.map((o) => (
                  <tr key={o.id} className={table.tr}>
                    <td className={cn(table.td, "whitespace-nowrap")}>
                      <Link href={`${BASE}/${o.id}`} className="font-mono text-xs font-medium hover:underline">
                        {o.number}
                      </Link>
                    </td>
                    <td className={table.td}>
                      <p className="font-medium">{o.customerName}</p>
                      <p className="text-xs text-neutral-500">{o.customerEmail}</p>
                    </td>
                    <td className={cn(table.td, "whitespace-nowrap text-right tabular-nums")}>{formatCents(o.totalCents)}</td>
                    <td className={table.td}>
                      <StatusBadge status={o.paymentStatus} />
                    </td>
                    <td className={cn(table.td, "whitespace-nowrap")}>
                      <Badge tone={o.productionStatus === "COMPLETED" ? "dark" : "neutral"}>
                        {PRODUCTION_STATUS_LABELS[o.productionStatus] ?? statusLabel(o.productionStatus)}
                      </Badge>
                    </td>
                    <td className={cn(table.td, "whitespace-nowrap text-neutral-600")}>{formatDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} href={(p) => listHref(BASE, { page: p })} />
        </>
      )}
    </>
  );
}
