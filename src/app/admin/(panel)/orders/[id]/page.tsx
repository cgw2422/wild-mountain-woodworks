import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { formatCents } from "@/lib/money";
import { parseSnapshot } from "@/lib/pricing/snapshot";
import { Card, DescriptionList, PageHeader, StatusBadge, adminButton, formatDate } from "@/components/admin/ui";
import { CustomerCard, LongText } from "@/components/admin/inbox/CustomerCard";
import { NotesPanel } from "@/components/admin/inbox/NotesPanel";
import { SnapshotView } from "@/components/admin/inbox/SnapshotView";
import { StatusControl } from "@/components/admin/inbox/StatusControl";
import { StatusHistory } from "@/components/admin/inbox/StatusHistory";
import { PRODUCTION_STATUS_LABELS } from "@/components/admin/inbox/kinds";
import { addNoteAction, changeStatusAction } from "../../inbox-actions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const o = await prisma.order.findUnique({ where: { id }, select: { number: true } });
  return { title: o ? `Order ${o.number}` : "Order not found" };
}

/** Stripe-style address JSON → display lines (tolerant of unknown shapes). */
function addressLines(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const a = value as Record<string, unknown>;
  const src = (a.address && typeof a.address === "object" ? a.address : a) as Record<string, unknown>;
  const s = (k: string) => (typeof src[k] === "string" ? (src[k] as string) : "");
  const name = typeof a.name === "string" ? a.name : "";
  const cityLine = [s("city"), [s("state"), s("postal_code")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [name, s("line1"), s("line2"), cityLine, s("country")].filter(Boolean);
}

export default async function OrderDetailPage({ params }: Props) {
  const { id } = await params;
  const admin = await requireAdmin();
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: { orderBy: { createdAt: "asc" }, include: { product: { select: { id: true } } } },
      internalNotes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      statusEvents: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
    },
  });
  if (!order) notFound();

  const address = addressLines(order.shippingAddress);
  const mailto = `mailto:${order.customerEmail}?subject=${encodeURIComponent(`Your Wild Mountain order ${order.number}`)}`;
  const totals: Array<[string, number, boolean?]> = [
    ["Subtotal", order.subtotalCents],
    ...(order.discountCents ? ([[`Discount${order.promoCode ? ` (${order.promoCode})` : ""}`, -order.discountCents]] as Array<[string, number]>) : []),
    ["Delivery", order.shippingCents],
    ["Tax", order.taxCents],
    ["Total", order.totalCents, true],
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Future Orders", href: "/admin/orders" }, { label: order.number }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{order.number}</span>
            <StatusBadge status={order.status} />
          </span>
        }
        description={`Placed ${formatDate(order.createdAt, true)}${order.paidAt ? ` · paid ${formatDate(order.paidAt, true)}` : ""}`}
        actions={
          <a href={mailto} className={adminButton.primary}>
            Email customer
          </a>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card title={`Items (${order.items.length})`}>
            {order.items.length === 0 ? (
              <p className="text-sm text-neutral-500">This order has no items.</p>
            ) : (
              <ul className="divide-y divide-neutral-200">
                {order.items.map((item) => {
                  const snapshot = parseSnapshot(item.configuration);
                  return (
                    <li key={item.id} className="py-5 first:pt-0 last:pb-0">
                      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                        <p className="font-medium text-neutral-900">
                          {item.productName} <span className="text-neutral-500">× {item.quantity}</span>
                        </p>
                        <p className="tabular-nums text-neutral-700">
                          {formatCents(item.unitPriceCents)} each · <span className="font-semibold text-neutral-900">{formatCents(item.lineTotalCents)}</span>
                        </p>
                      </div>
                      {snapshot ? (
                        <SnapshotView snapshot={snapshot} currentProductId={item.product?.id ?? null} />
                      ) : (
                        <p className="text-sm text-neutral-500">No configuration snapshot stored for this item.</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Totals">
            <dl className="max-w-sm space-y-1 text-sm">
              {totals.map(([label, cents, strong]) => (
                <div key={label} className={strong ? "flex justify-between gap-4 border-t border-neutral-200 pt-2 font-semibold" : "flex justify-between gap-4"}>
                  <dt className={strong ? "" : "text-neutral-500"}>{label}</dt>
                  <dd className="tabular-nums">{formatCents(cents)}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {order.customerNotes ? (
            <Card title="Notes from customer">
              <LongText text={order.customerNotes} />
            </Card>
          ) : null}

          <NotesPanel notes={order.internalNotes} currentAdminId={admin.id} addAction={addNoteAction.bind(null, "order", order.id)} />
        </div>

        <div className="min-w-0 space-y-6">
          <CustomerCard name={order.customerName} email={order.customerEmail} phone={order.customerPhone} mailto={mailto} />

          <Card title="Payment">
            <DescriptionList
              className="sm:grid-cols-[7rem_1fr]"
              items={[
                { label: "Payment", value: <StatusBadge status={order.paymentStatus} /> },
                { label: "Order", value: <StatusBadge status={order.status} /> },
                { label: "Stripe session", value: order.stripeCheckoutSessionId ? <code className="text-xs">{order.stripeCheckoutSessionId}</code> : null },
                { label: "Payment intent", value: order.stripePaymentIntentId ? <code className="text-xs">{order.stripePaymentIntentId}</code> : null },
                { label: "Ship to", value: address.length ? <span className="block">{address.map((l, i) => <span key={i} className="block">{l}</span>)}</span> : null },
              ]}
            />
            <p className="mt-3 text-xs text-neutral-500">Payment status is updated automatically by Stripe and can&apos;t be edited here.</p>
          </Card>

          <Card title="Production">
            <StatusControl
              action={changeStatusAction.bind(null, "order", order.id)}
              current={order.productionStatus}
              label="Production status"
              options={Object.values(ProductionStatus).map((s) => ({ value: s, label: PRODUCTION_STATUS_LABELS[s] }))}
            />
            <h3 className="mb-3 mt-6 text-sm font-semibold text-neutral-900">History</h3>
            <StatusHistory events={order.statusEvents} originLabel="Created at checkout" />
          </Card>
        </div>
      </div>
    </>
  );
}
