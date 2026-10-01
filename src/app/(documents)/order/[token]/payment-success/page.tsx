import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCents } from "@/lib/money";
import { noteCheckoutReturn } from "@/lib/sales/checkout";
import { PRODUCTION_STATUS_LABELS } from "@/lib/sales/status";
import { customerOrderView } from "@/lib/sales/views";
import { buttonClasses } from "@/components/ui/Button";
import { DocHeading, Facts } from "@/components/documents/parts";
import { AutoRefresh } from "@/components/documents/AutoRefresh";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ session_id?: string | string[] }> };

export const metadata: Metadata = { title: "Payment received" };

/**
 * Where Stripe Checkout returns the customer. This page only DISPLAYS the
 * payment state; the deposit is marked paid solely by Stripe's verified
 * webhook. Until that arrives (usually seconds) it shows "confirming" and
 * refreshes itself.
 */
export default async function PaymentSuccessPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { session_id } = await searchParams;
  if (!(await customerOrderView(token))) notFound();
  await noteCheckoutReturn(token, typeof session_id === "string" ? session_id : undefined);
  const o = (await customerOrderView(token))!;
  // The most recent settled payment — shown only if it just happened (this
  // page is a return from Stripe, not a payment record).
  const last = o.payments.filter((p) => !p.pending).at(-1);
  const confirming = o.confirming;
  const justPaid = !confirming && o.recentlyPaid;
  if (!justPaid && !confirming) {
    // Nothing recent and no completed checkout: this isn't a payment confirmation.
    const what = o.due?.type === "FINAL_BALANCE" ? "payment" : "deposit";
    return (
      <article>
        <DocHeading eyebrow={`Order ${o.number}`} title={`Your ${what} hasn't been received yet`} status={{ label: o.due?.type === "FINAL_BALANCE" ? "Balance due" : "Deposit due", tone: "warn" }}>
          <p className="lede mt-4 max-w-2xl text-muted">
            {o.due?.payHref ? "If you left the payment page before finishing, you can pick up where you left off." : "Please see your order page for how to pay."}
          </p>
        </DocHeading>
        <div className="mt-10 flex flex-wrap gap-3">
          {o.due?.payHref ? (
            <a href={o.due.payHref} rel="nofollow" className={buttonClasses("primary", "lg")}>
              Pay {formatCents(o.due.amountCents)} {o.due.type === "FINAL_BALANCE" ? "Balance" : "Deposit"}
            </a>
          ) : null}
          <Link href={`/order/${token}`} className={buttonClasses(o.due?.payHref ? "secondary" : "primary", "lg")}>
            View Your Order
          </Link>
        </div>
      </article>
    );
  }
  const deposit = last?.label === "Deposit";
  const title = confirming ? "Thank you — we're confirming your payment." : deposit ? "Thank you — your deposit has been received." : o.balanceCents <= 0 ? "Thank you — your order is paid in full." : "Thank you — your payment has been received.";

  return (
    <article>
      <DocHeading eyebrow={`Order ${o.number}`} title={title} status={confirming ? { label: "Confirming", tone: "warn" } : { label: deposit ? "Deposit paid" : o.balanceCents <= 0 ? "Paid in full" : "Payment received", tone: "good" }}>
        <p className="lede mt-4 max-w-2xl text-muted">
          {confirming
            ? "Stripe has your payment and is confirming it with us. This usually takes a few seconds — this page updates on its own."
            : deposit
              ? "Your piece is now ready to move into the next stage of production. We've emailed you a confirmation."
              : "We've emailed you a receipt."}
        </p>
      </DocHeading>
      {confirming ? <AutoRefresh /> : null}

      <div className="mt-10">
        <Facts
          items={[
            { label: "Order number", value: o.number },
            { label: deposit ? "Deposit paid" : "This payment", value: last && !confirming ? formatCents(last.amountCents, { showZeroCents: true }) : null },
            { label: "Paid so far", value: formatCents(o.paidCents, { showZeroCents: true }) },
            { label: "Remaining balance", value: formatCents(o.balanceCents, { showZeroCents: true }) },
            { label: "Production status", value: PRODUCTION_STATUS_LABELS[o.productionStatus] },
            { label: "Estimated completion", value: o.estimatedCompletion },
          ]}
        />
      </div>

      <div className="mt-12 flex flex-wrap gap-3">
        <Link href={`/order/${token}`} className={buttonClasses("primary", "lg")}>
          View Your Order
        </Link>
      </div>
    </article>
  );
}
