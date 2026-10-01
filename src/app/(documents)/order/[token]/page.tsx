import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/money";
import { CUSTOMER_PROGRESS, ORDER_PAYMENT_STATUS_LABELS, PRODUCTION_STATUS_LABELS } from "@/lib/sales/status";
import { customerOrderView } from "@/lib/sales/views";
import { siteDateLong } from "@/lib/site-time";
import { buttonClasses } from "@/components/ui/Button";
import { AutoRefresh } from "@/components/documents/AutoRefresh";
import { AddOnChoices, DocHeading, Facts, Files, Prose, Section, statusPill } from "@/components/documents/parts";
import { DepositMethodsNote, FinanceFullPurchase } from "@/components/payments/PaymentOptions";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ payment?: string }> };

export const metadata: Metadata = { title: "Your order" };

const PAYMENT_NOTICES: Record<string, string> = {
  canceled: "Your payment wasn't completed, so nothing was charged. You can pay whenever you're ready.",
  error: "We couldn't open the secure payment page just now. Please try again in a moment, or contact us.",
  limited: "Too many attempts in a short time. Please wait a few minutes and try again.",
  "financing-unavailable": "Financing is only available for the full order total before any payment has been made. You can pay the amount due instead, or contact us.",
};

/**
 * The customer's order page — their main source of truth: the current stage,
 * payment status, what's been paid and what remains, delivery details and
 * milestones. No shop notes, costs or internal comments ever reach it.
 */
export default async function CustomerOrderPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { payment } = await searchParams;
  const o = await customerOrderView(token);
  if (!o) notFound();
  const canceled = o.canceled;
  const awaitingDeposit = o.productionStatus === "AWAITING_DEPOSIT";
  const step = CUSTOMER_PROGRESS.findIndex((s) => s.status === o.productionStatus);
  const due = o.due;
  const dueLabel = due?.type === "DEPOSIT" ? "Deposit" : "Balance";
  const primaryInvoice = o.invoices.find((i) => !i.voided);

  return (
    <article>
      <DocHeading eyebrow="Order" title={o.number} status={statusPill(o.productionStatus)}>
        <p className="mt-3 text-sm text-muted">Placed {siteDateLong(o.placedAt)}</p>
      </DocHeading>

      {payment && PAYMENT_NOTICES[payment] && due ? (
        <p role="status" className="mt-8 border-l-2 border-bronze bg-paper px-5 py-4">
          {PAYMENT_NOTICES[payment]}
        </p>
      ) : null}

      {/* Progress */}
      {canceled ? (
        <div role="note" className="mt-10 border border-error/40 bg-paper px-5 py-5">
          <p className="text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-error">Canceled</p>
          <p className="mt-2">This order has been canceled. Please contact us with any questions about it.</p>
        </div>
      ) : (
        <section aria-labelledby="progress-heading" className="mt-10">
          <h2 id="progress-heading" className="sr-only">
            Progress
          </h2>
          {awaitingDeposit ? (
            <p className="mb-5 inline-flex items-center gap-3 border border-bronze/50 bg-paper px-4 py-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-bronze" aria-hidden="true" />
              Awaiting deposit — your build is scheduled once it&apos;s received.
            </p>
          ) : null}
          <ol className="grid gap-4 sm:grid-cols-5 sm:gap-3" aria-label="Order progress">
            {CUSTOMER_PROGRESS.map((s, i) => {
              const done = step >= 0 && (i < step || o.productionStatus === "COMPLETED");
              const current = i === step && o.productionStatus !== "COMPLETED";
              return (
                <li key={s.status} aria-current={current ? "step" : undefined} className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2.5">
                  <span className={cn("h-px w-10 shrink-0 sm:w-full", done ? "h-0.5 bg-charcoal" : current ? "h-0.5 bg-bronze" : "bg-stone-dark/60")} aria-hidden="true" />
                  <span className={cn("text-[0.95rem]", current ? "font-semibold text-charcoal" : done ? "text-charcoal" : "text-muted")}>
                    {s.label}
                    <span className="sr-only">{done ? " (done)" : current ? " (current)" : ""}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* Money */}
      <section aria-labelledby="money-heading" className="mt-10 border border-charcoal bg-paper p-6 md:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="money-heading" className="font-display text-2xl">
            {o.balanceCents <= 0 && o.totalCents > 0 ? "Paid in full — thank you" : due && !canceled ? `${dueLabel} due` : "Payment"}
          </h2>
          <span className="text-sm text-muted">{ORDER_PAYMENT_STATUS_LABELS[o.paymentStatus]}</span>
        </div>
        {o.balanceCents <= 0 && o.paidInFullWith ? (
          <p className="mt-2 text-sm text-muted">
            Paid with {o.paidInFullWith}
            {o.paidInFullFinanced ? ` — any repayments are between you and ${o.paidInFullWith}; nothing more is owed to Wild Mountain Woodworks for this order.` : "."}
          </p>
        ) : null}
        <dl className="mt-5 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-[0.98rem]">
          <dt>Invoice total</dt>
          <dd className="text-right tabular-nums">{formatCents(o.totalCents, { showZeroCents: true })}</dd>
          <dt>Paid</dt>
          <dd className="text-right tabular-nums">{formatCents(o.paidCents, { showZeroCents: true })}</dd>
          {o.pendingCents > 0 ? (
            <>
              <dt className="text-muted">Pending (not yet cleared)</dt>
              <dd className="text-right tabular-nums text-muted">{formatCents(o.pendingCents, { showZeroCents: true })}</dd>
            </>
          ) : null}
          <dt className="border-t border-charcoal pt-2 font-semibold">Remaining balance</dt>
          <dd className="border-t border-charcoal pt-2 text-right font-semibold tabular-nums">{formatCents(o.balanceCents, { showZeroCents: true })}</dd>
        </dl>
        {o.confirming ? (
          <>
            <p className="mt-5 text-muted">Stripe has your payment and is confirming it with us. This page will update shortly.</p>
            <AutoRefresh />
          </>
        ) : (due?.payHref || o.financing) && !canceled ? (
          <div className="print:hidden">
            {due?.payHref ? (
              <>
                {/* A plain link: the server opens a fresh, correctly priced Stripe Checkout each time (no Affirm/Klarna for a deposit or balance). */}
                <a href={due.payHref} rel="nofollow" className={buttonClasses("primary", "lg", "mt-6")}>
                  Pay {formatCents(due.amountCents)} {dueLabel}
                </a>
                {due.type === "DEPOSIT" ? <p className="mt-2 max-w-xl text-sm text-charcoal">Pay the required deposit today. The remaining {formatCents(Math.max(0, o.totalCents - due.amountCents - o.paidCents))} will be due later.</p> : null}
                <DepositMethodsNote messaging={o.paymentMessaging} className="mt-3 max-w-xl" />
              </>
            ) : null}
            {o.financing ? (
              <FinanceFullPurchase
                className="mt-6 max-w-xl"
                messaging={o.paymentMessaging}
                totalCents={o.financing.amountCents}
                href={o.financing.href}
                stripe={o.stripePublishableKey ? { publishableKey: o.stripePublishableKey, amountCents: o.financing.amountCents } : null}
              />
            ) : null}
            <p className="mt-4 text-xs text-muted">You&apos;ll pay on Stripe&apos;s secure page, which shows the payment options available to you. Wild Mountain Woodworks never stores your payment details.</p>
          </div>
        ) : o.paymentInstructions && due ? (
          <div className="mt-5 whitespace-pre-line leading-relaxed text-charcoal-muted">{o.paymentInstructions}</div>
        ) : null}
        {primaryInvoice?.href ? (
          <Link href={primaryInvoice.href} className={buttonClasses("text", "md", "mt-4 print:hidden")}>
            View invoice {primaryInvoice.number}
          </Link>
        ) : null}
      </section>

      <div className="mt-10">
        <Facts
          items={[
            { label: "Order status", value: PRODUCTION_STATUS_LABELS[o.productionStatus] },
            { label: "Payment status", value: ORDER_PAYMENT_STATUS_LABELS[o.paymentStatus] },
            { label: "Estimated completion", value: o.productionStatus === "COMPLETED" ? null : o.estimatedCompletion },
            { label: o.delivery.method === "Customer pickup" ? "Pickup" : "Delivery", value: o.delivery.date ? [siteDateLong(o.delivery.date), o.delivery.window, o.delivery.method].filter(Boolean).join(" · ") : null },
            { label: "Delivery address", value: o.delivery.method === "Customer pickup" ? null : o.delivery.address },
            { label: "Delivery notes", value: o.delivery.notes },
          ]}
        />
      </div>

      <Section title="Your piece">
        <ul className="divide-y divide-stone border-y border-stone">
          {o.items.map((i, n) => (
            <li key={n} className={cn("flex flex-wrap justify-between gap-3 py-4", i.addOn && "ml-4 border-l-2 border-bronze/50 pl-4")}>
              <div>
                {i.addOn ? <p className="mb-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-bronze-text">Add-on</p> : null}
                <p className="font-medium">
                  {i.description}
                  {i.quantity > 1 && !i.addOn ? ` × ${i.quantity}` : ""}
                </p>
                {i.addOn ? (
                  <>
                    <AddOnChoices addOn={i.addOn} />
                    <p className="mt-1 text-sm tabular-nums text-muted">
                      {i.quantity} × {formatCents(i.unitPriceCents)} each
                    </p>
                  </>
                ) : i.notes ? (
                  <p className="mt-1 whitespace-pre-line text-sm text-muted">{i.notes}</p>
                ) : null}
              </div>
              <p className="tabular-nums">{i.lineTotalCents < 0 ? `−${formatCents(-i.lineTotalCents)}` : formatCents(i.lineTotalCents)}</p>
            </li>
          ))}
        </ul>
      </Section>

      {o.payments.length ? (
        <Section title="Payments received">
          <ul className="divide-y divide-stone border-y border-stone">
            {o.payments.map((p, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-3 py-3 text-[0.98rem]">
                <span>
                  {siteDateLong(p.receivedAt)} — {p.label}
                  {p.pending ? <span className="text-muted"> · pending</span> : null}
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

      {o.milestones.length ? (
        <Section title="Milestones">
          <ol className="space-y-3 border-l border-stone pl-5">
            {o.milestones.map((m, i) => (
              <li key={i} className="relative">
                <span className={cn("absolute -left-[1.6rem] top-2 h-2 w-2 rounded-full", m.kind === "payment" ? "bg-bronze" : "bg-charcoal")} aria-hidden="true" />
                <p className="text-[0.98rem]">
                  {m.label}
                  <span className="ml-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted">{m.kind === "payment" ? "Payment" : "Order"}</span>
                </p>
                <p className="text-sm text-muted">{siteDateLong(m.at)}</p>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {o.customerNotes ? (
        <Section title="Notes from the shop">
          <Prose text={o.customerNotes} />
        </Section>
      ) : null}

      {o.files.length ? (
        <Section title="Drawings & photos">
          <Files files={o.files} />
        </Section>
      ) : null}

      <div className="mt-12 flex flex-wrap gap-4 print:hidden">
        {o.quote ? (
          <Link href={o.quote.href} className={buttonClasses("secondary", "md")}>
            View accepted quote {o.quote.number}
          </Link>
        ) : null}
        <Link href={`/contact?reason=EXISTING_QUOTE`} className={buttonClasses("text", "md")}>
          Questions? Contact us
        </Link>
      </div>
    </article>
  );
}
