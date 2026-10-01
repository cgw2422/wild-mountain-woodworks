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
  const paid = o.deposit ? o.deposit.paid : o.paidCents > 0;
  const confirming = !paid && Boolean(o.deposit?.confirming);
  if (!paid && !confirming) {
    // Not paid and no completed checkout: this isn't a payment confirmation.
    return (
      <article>
        <DocHeading eyebrow={`Order ${o.number}`} title="Your deposit hasn't been received yet" status={{ label: "Deposit due", tone: "warn" }}>
          <p className="lede mt-4 max-w-2xl text-muted">
            {o.deposit?.payHref ? "If you left the payment page before finishing, you can pick up where you left off." : "Please see your order page for how to pay your deposit."}
          </p>
        </DocHeading>
        <div className="mt-10 flex flex-wrap gap-3">
          {o.deposit?.payHref ? (
            <a href={o.deposit.payHref} rel="nofollow" className={buttonClasses("primary", "lg")}>
              Pay {formatCents(o.deposit.dueCents)} Deposit
            </a>
          ) : null}
          <Link href={`/order/${token}`} className={buttonClasses(o.deposit?.payHref ? "secondary" : "primary", "lg")}>
            View Your Order
          </Link>
        </div>
      </article>
    );
  }

  return (
    <article>
      <DocHeading eyebrow={`Order ${o.number}`} title={paid ? "Thank you — your deposit has been received." : "Thank you — we're confirming your payment."} status={paid ? { label: "Deposit paid", tone: "good" } : { label: "Confirming", tone: "warn" }}>
        <p className="lede mt-4 max-w-2xl text-muted">
          {paid
            ? "Your piece is now ready to move into the next stage of production. We've emailed you a confirmation."
            : "Stripe has your payment and is confirming it with us. This usually takes a few seconds — this page updates on its own."}
        </p>
      </DocHeading>
      {!paid ? <AutoRefresh /> : null}

      <div className="mt-10">
        <Facts
          items={[
            { label: "Order number", value: o.number },
            { label: "Deposit paid", value: o.deposit ? formatCents(paid ? o.deposit.amountCents : 0, { showZeroCents: true }) : formatCents(o.paidCents, { showZeroCents: true }) },
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
