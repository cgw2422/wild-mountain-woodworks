import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { parseSnapshot } from "@/lib/pricing/snapshot";
import { siteDateLong } from "@/lib/site-time";
import { DELIVERY_STATUS_LABELS, PRODUCTION_STATUS_LABELS } from "@/lib/sales/status";
import { Logo } from "@/components/brand/Logo";
import { PrintButton } from "@/components/documents/PrintButton";

export const metadata: Metadata = { title: "Work order", robots: { index: false, follow: false } };

/**
 * Printable shop work order: what to build, options, dimensions, delivery and
 * shop notes. No prices — it goes on the bench, not to the customer.
 */
export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales");
  const { id } = await params;
  const order = await prisma.order.findUnique({ where: { id }, include: { items: { orderBy: { position: "asc" } }, quote: { select: { number: true, requestedDimensions: true, timeline: true } } } });
  if (!order) notFound();
  const pieces = order.items.filter((i) => ["PRODUCT", "CUSTOM", "ADDON"].includes(i.kind));
  return (
    <div className="mx-auto max-w-3xl bg-white px-6 py-8 text-[15px] text-neutral-900 print:max-w-none print:p-0">
      <div className="flex items-start justify-between gap-6 border-b-2 border-neutral-900 pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Work order</p>
          <h1 className="mt-1 font-mono text-3xl font-semibold">{order.number}</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Placed {siteDateLong(order.createdAt)}
            {order.quote?.number ? ` · Quote ${order.quote.number}` : ""}
          </p>
        </div>
        <Logo className="h-10 w-auto text-neutral-900" title="" />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="font-semibold">Customer</p>
          <p>{order.customerName}</p>
          <p>{order.customerPhone ?? order.customerEmail}</p>
        </div>
        <div>
          <p className="font-semibold">Status</p>
          <p>{PRODUCTION_STATUS_LABELS[order.productionStatus]}</p>
          <p>Target: {order.estimatedCompletion ?? "—"}</p>
        </div>
        <div>
          <p className="font-semibold">Delivery</p>
          <p>
            {DELIVERY_STATUS_LABELS[order.deliveryStatus]}
            {order.deliveryDate ? ` · ${siteDateLong(order.deliveryDate)}` : ""}
          </p>
          <p className="whitespace-pre-line">{order.deliveryAddress ?? "—"}</p>
        </div>
        <div>
          <p className="font-semibold">Timeline requested</p>
          <p>{order.quote?.timeline ?? "—"}</p>
        </div>
      </div>

      <h2 className="mt-8 border-b border-neutral-300 pb-1 text-lg font-semibold">To build</h2>
      <ol className="mt-3 space-y-5">
        {pieces.map((i) => {
          const snap = parseSnapshot(i.configuration);
          return (
            <li key={i.id} className="break-inside-avoid">
              <p className="text-base font-semibold">
                {i.quantity} × {i.description ?? i.productName}
              </p>
              {snap ? (
                <table className="mt-2 w-full text-sm">
                  <tbody>
                    {snap.options.map((o) => (
                      <tr key={o.groupId} className="border-b border-neutral-200">
                        <th scope="row" className="w-1/3 py-1 pr-4 text-left font-medium text-neutral-600">
                          {o.groupDisplayName}
                        </th>
                        <td className="py-1">
                          {o.valueDisplayName}
                          {o.customDetails ? ` — ${o.customDetails}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {i.notes ? <p className="mt-2 whitespace-pre-line text-sm">{i.notes}</p> : null}
            </li>
          );
        })}
      </ol>

      {order.quote?.requestedDimensions ? (
        <>
          <h2 className="mt-8 border-b border-neutral-300 pb-1 text-lg font-semibold">Requested dimensions</h2>
          <p className="mt-2 whitespace-pre-line">{order.quote.requestedDimensions}</p>
        </>
      ) : null}

      <h2 className="mt-8 border-b border-neutral-300 pb-1 text-lg font-semibold">Shop notes</h2>
      <p className="mt-2 min-h-24 whitespace-pre-line">{order.productionNotes ?? ""}</p>
      {order.deliveryNotes ? (
        <>
          <h2 className="mt-6 border-b border-neutral-300 pb-1 text-lg font-semibold">Delivery notes</h2>
          <p className="mt-2 whitespace-pre-line">{order.deliveryNotes}</p>
        </>
      ) : null}

      <div className="mt-10 grid grid-cols-3 gap-6 text-xs text-neutral-500">
        {["Milled", "Assembled", "Finished"].map((s) => (
          <div key={s} className="border-t border-neutral-400 pt-1">
            {s} — date / initials
          </div>
        ))}
      </div>

      <div className="mt-8 print:hidden">
        <PrintButton label="Print work order" />
      </div>
    </div>
  );
}
