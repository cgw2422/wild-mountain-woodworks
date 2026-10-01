import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCents } from "@/lib/money";
import { noteCheckoutReturn } from "@/lib/sales/checkout";
import { customerInvoiceView } from "@/lib/sales/views";
import { buttonClasses } from "@/components/ui/Button";
import { AutoRefresh } from "@/components/documents/AutoRefresh";
import { DocHeading, Facts } from "@/components/documents/parts";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ session_id?: string | string[] }> };

export const metadata: Metadata = { title: "Payment received" };

/**
 * Where Stripe Checkout returns the customer after paying on the invoice
 * page. Display only: the payment is recorded solely by Stripe's verified
 * webhook, so until it arrives this shows "confirming" and refreshes.
 */
export default async function InvoicePaymentSuccessPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { session_id } = await searchParams;
  if (!(await customerInvoiceView(token))) notFound();
  await noteCheckoutReturn({ invoiceToken: token }, typeof session_id === "string" ? session_id : undefined);
  const inv = (await customerInvoiceView(token))!;
  const last = inv.payments.filter((p) => !p.pending).at(-1);
  const received = Boolean(last) && inv.recentlyPaid && !inv.confirming;

  if (!received && !inv.confirming) {
    return (
      <article>
        <DocHeading eyebrow={`Invoice ${inv.number}`} title="We haven't received a payment yet" status={statusFor(inv.status)} />
        <p className="lede mt-6 max-w-2xl text-muted">If you left the payment page before finishing, you can pick up where you left off.</p>
        <div className="mt-10 flex flex-wrap gap-3">
          {inv.payHref ? (
            <a href={inv.payHref} rel="nofollow" className={buttonClasses("primary", "lg")}>
              Pay {formatCents(inv.dueNowCents)}
            </a>
          ) : null}
          <Link href={`/invoice/${token}`} className={buttonClasses(inv.payHref ? "secondary" : "primary", "lg")}>
            View Invoice
          </Link>
        </div>
      </article>
    );
  }

  return (
    <article>
      <DocHeading
        eyebrow={`Invoice ${inv.number}`}
        title={inv.confirming ? "Thank you — we're confirming your payment." : "Thank you — your payment has been received."}
        status={inv.confirming ? { label: "Confirming", tone: "warn" } : { label: inv.remainingCents <= 0 ? "Paid in full" : "Payment received", tone: "good" }}
      >
        <p className="lede mt-4 max-w-2xl text-muted">
          {inv.confirming ? "Stripe has your payment and is confirming it with us. This usually takes a few seconds — this page updates on its own." : "We've emailed you a receipt."}
        </p>
      </DocHeading>
      {inv.confirming ? <AutoRefresh /> : null}
      <div className="mt-10">
        <Facts
          items={[
            { label: "Invoice", value: inv.number },
            { label: "Order", value: inv.orderNumber },
            { label: "Payments received", value: formatCents(inv.paidCents, { showZeroCents: true }) },
            { label: "Remaining balance", value: formatCents(inv.remainingCents, { showZeroCents: true }) },
          ]}
        />
      </div>
      <div className="mt-12 flex flex-wrap gap-3">
        <Link href={`/invoice/${token}`} className={buttonClasses("primary", "lg")}>
          View Invoice
        </Link>
        {inv.orderHref ? (
          <Link href={inv.orderHref} className={buttonClasses("secondary", "lg")}>
            View Your Order
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function statusFor(status: string) {
  return { label: status === "BALANCE_DUE" ? "Balance due" : status === "DEPOSIT_DUE" ? "Deposit due" : "Open", tone: "warn" as const };
}
