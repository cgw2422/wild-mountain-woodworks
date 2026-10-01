import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCents } from "@/lib/money";
import { ORDER_PAYMENT_STATUS_LABELS, PRODUCTION_STATUS_LABELS } from "@/lib/sales/status";
import { customerInvoiceView } from "@/lib/sales/views";
import { siteDateLong } from "@/lib/site-time";
import { buttonClasses } from "@/components/ui/Button";
import { AutoRefresh } from "@/components/documents/AutoRefresh";
import { DocHeading, Facts, LinesTable, Prose, Section, TotalsBlock, statusPill } from "@/components/documents/parts";
import { PrintButton } from "@/components/documents/PrintButton";
import { DepositMethodsNote, FinanceFullPurchase } from "@/components/payments/PaymentOptions";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ payment?: string | string[] }> };

export const metadata: Metadata = { title: "Your invoice" };

const NOTICES: Record<string, string> = {
  canceled: "Your payment wasn't completed — nothing was charged. You can pay whenever you're ready.",
  error: "We couldn't open the secure payment page just now. Please try again in a moment, or contact us.",
  limited: "Too many attempts. Please wait a few minutes and try again.",
  "financing-unavailable": "Financing is only available for the full order total before any payment has been made. You can pay the amount due instead, or contact us.",
};

/**
 * The customer's main financial page: the one Wild Mountain Woodworks invoice for their
 * order, what's been paid, what remains, and — when a payment is due — a
 * button that opens Stripe's secure checkout for exactly that amount
 * (computed on the server). Printable as the branded invoice.
 */
export default async function CustomerInvoicePage({ params, searchParams }: Props) {
  const { token } = await params;
  const { payment } = await searchParams;
  const inv = await customerInvoiceView(token);
  if (!inv) notFound();
  const notice = typeof payment === "string" ? NOTICES[payment] : undefined;
  const dueLabel = inv.dueNowType === "DEPOSIT" ? "Deposit" : "Balance";

  return (
    <article>
      <DocHeading eyebrow="Invoice" title={inv.number} status={statusPill(inv.status)}>
        <p className="mt-3 text-sm text-muted">
          Issued {siteDateLong(inv.issuedAt)}
          {inv.paidAt && inv.status === "PAID" ? ` · Paid in full ${siteDateLong(inv.paidAt)}` : null}
        </p>
      </DocHeading>

      {notice ? (
        <p role="status" className="mt-8 border-l-2 border-bronze bg-paper px-5 py-4 print:hidden">
          {notice}
        </p>
      ) : null}
      {inv.voided ? (
        <p role="note" className="mt-8 border-l-2 border-error bg-paper px-5 py-4">
          This invoice has been voided and no payment is due on it.
        </p>
      ) : null}

      {!inv.voided ? (
        <section aria-labelledby="balance-heading" className="mt-10 border border-charcoal bg-paper p-6 md:p-8">
          <h2 id="balance-heading" className="font-display text-2xl">
            {inv.remainingCents <= 0 ? "Paid in full — thank you" : inv.dueNowCents > 0 ? `${dueLabel} due` : "Balance"}
          </h2>
          {inv.remainingCents <= 0 && inv.paidInFullWith ? (
            <p className="mt-2 text-sm text-muted">
              Paid with {inv.paidInFullWith}
              {inv.paidInFullFinanced ? ` — any repayments are between you and ${inv.paidInFullWith}; nothing more is owed to Wild Mountain Woodworks for this invoice.` : "."}
            </p>
          ) : null}
          <dl className="mt-5 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-[0.98rem]">
            <dt>Order total</dt>
            <dd className="text-right tabular-nums">{formatCents(inv.totalCents, { showZeroCents: true })}</dd>
            {inv.depositCents > 0 && !inv.paidInFullWith ? (
              <>
                <dt className="text-muted">Deposit required</dt>
                <dd className="text-right tabular-nums text-muted">{formatCents(inv.depositCents, { showZeroCents: true })}</dd>
              </>
            ) : null}
            <dt>Payments received</dt>
            <dd className="text-right tabular-nums">{formatCents(inv.paidCents, { showZeroCents: true })}</dd>
            {inv.pendingCents > 0 ? (
              <>
                <dt className="text-muted">Pending (not yet cleared)</dt>
                <dd className="text-right tabular-nums text-muted">{formatCents(inv.pendingCents, { showZeroCents: true })}</dd>
              </>
            ) : null}
            <dt className="border-t border-charcoal pt-2 font-semibold">Remaining balance</dt>
            <dd className="border-t border-charcoal pt-2 text-right font-semibold tabular-nums">{formatCents(inv.remainingCents, { showZeroCents: true })}</dd>
          </dl>

          {inv.confirming ? (
            <>
              <p className="mt-5 text-muted">Stripe has your payment and is confirming it with us. This page updates on its own.</p>
              <AutoRefresh />
            </>
          ) : inv.payHref || inv.financing ? (
            <div className="print:hidden">
              {inv.payHref ? (
                <>
                  {/* A plain link: the server opens a Stripe Checkout for exactly what's due (Affirm/Klarna aren't offered for it). */}
                  <a href={inv.payHref} rel="nofollow" className={buttonClasses("primary", "lg", "mt-6")}>
                    {inv.dueNowType === "FINAL_BALANCE" ? "Pay Remaining Balance" : `Pay ${formatCents(inv.dueNowCents, { showZeroCents: true })} ${dueLabel}`}
                  </a>
                  {inv.dueNowType === "FINAL_BALANCE" ? <p className="mt-2 text-sm tabular-nums">{formatCents(inv.dueNowCents, { showZeroCents: true })} due now</p> : null}
                  <DepositMethodsNote messaging={inv.paymentMessaging} className="mt-3 max-w-xl" />
                </>
              ) : null}
              {inv.financing ? (
                <FinanceFullPurchase
                  className="mt-6 max-w-xl"
                  messaging={inv.paymentMessaging}
                  totalCents={inv.financing.amountCents}
                  href={inv.financing.href}
                  stripe={inv.stripePublishableKey ? { publishableKey: inv.stripePublishableKey, amountCents: inv.financing.amountCents } : null}
                />
              ) : null}
              <p className="mt-4 text-xs text-muted">You&apos;ll pay on Stripe&apos;s secure page, which shows the payment options available to you. Wild Mountain Woodworks never stores your payment details.</p>
            </div>
          ) : inv.remainingCents > 0 && !inv.paymentInstructions ? (
            <p className="mt-5 text-sm text-muted">{inv.depositCents > 0 && inv.paidCents >= inv.depositCents ? "Your deposit is received. We'll let you know when the remaining balance is due." : "We'll let you know when a payment is due."}</p>
          ) : null}
          {inv.paymentInstructions && inv.dueNowCents > 0 ? <div className="mt-5 whitespace-pre-line leading-relaxed text-charcoal-muted">{inv.paymentInstructions}</div> : null}
        </section>
      ) : null}

      <div className="mt-10">
        <Facts
          items={[
            { label: "Invoice", value: inv.number },
            { label: "Order", value: inv.orderNumber },
            { label: "Quote", value: inv.quoteNumber },
            { label: "Order status", value: inv.productionStatus ? PRODUCTION_STATUS_LABELS[inv.productionStatus] : null },
            { label: "Payment status", value: inv.orderPaymentStatus ? ORDER_PAYMENT_STATUS_LABELS[inv.orderPaymentStatus] : null },
            { label: "Billed to", value: `${inv.customer.name}\n${inv.customer.email}` },
            { label: "From", value: [inv.business.name, inv.business.email, inv.business.phone].filter(Boolean).join("\n") },
          ]}
        />
      </div>

      <Section title="Your furniture">
        <LinesTable lines={inv.lines} />
        <TotalsBlock
          totals={inv.totals}
          extra={inv.voided ? [] : [...(inv.paidCents ? [{ label: "Payments received", cents: -inv.paidCents }] : []), { label: "Remaining balance", cents: inv.remainingCents, strong: true }]}
        />
      </Section>

      {inv.payments.length ? (
        <Section title="Payments received">
          <ul className="divide-y divide-stone border-y border-stone">
            {inv.payments.map((p, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-3 py-3 text-[0.98rem]">
                <span>
                  {siteDateLong(p.receivedAt)} — {p.label}
                  {p.pending ? <span className="text-muted"> · pending ({p.method.toLowerCase()} not yet cleared)</span> : null}
                </span>
                <span className="tabular-nums">
                  {formatCents(p.amountCents, { showZeroCents: true })}
                  {p.refundedCents ? <span className="text-muted"> (refunded {formatCents(p.refundedCents, { showZeroCents: true })})</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {inv.delivery && (inv.delivery.address || inv.delivery.date || inv.delivery.estimatedCompletion) ? (
        <Section title="Delivery">
          <Facts
            items={[
              { label: "Delivery address", value: inv.delivery.address },
              { label: "Scheduled", value: inv.delivery.date ? [siteDateLong(inv.delivery.date), inv.delivery.window, inv.delivery.method].filter(Boolean).join(" · ") : null },
              { label: "Estimated completion", value: inv.delivery.estimatedCompletion },
              { label: "Delivery notes", value: inv.delivery.notes },
            ]}
          />
        </Section>
      ) : null}

      {inv.customerNotes ? (
        <Section title="Notes">
          <Prose text={inv.customerNotes} />
        </Section>
      ) : null}
      {inv.terms ? (
        <Section title="Terms">
          <Prose text={inv.terms} />
        </Section>
      ) : null}

      <div className="mt-12 flex flex-col gap-3 sm:flex-row sm:flex-wrap print:hidden">
        {inv.pdfUrl ? (
          <a href={inv.pdfUrl} className={buttonClasses("secondary", "lg")} rel="noopener noreferrer">
            Download PDF
          </a>
        ) : (
          <PrintButton />
        )}
        {inv.orderHref ? (
          <Link href={inv.orderHref} className={buttonClasses("text", "md", "sm:ml-auto")}>
            View order {inv.orderNumber}
          </Link>
        ) : null}
      </div>
    </article>
  );
}
