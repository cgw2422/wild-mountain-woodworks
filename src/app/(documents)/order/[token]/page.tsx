import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/money";
import { CUSTOMER_PROGRESS, DELIVERY_STATUS_LABELS, INVOICE_KIND_LABELS, ORDER_PAYMENT_STATUS_LABELS } from "@/lib/sales/status";
import { customerOrderView } from "@/lib/sales/views";
import { siteDateLong } from "@/lib/site-time";
import { buttonClasses } from "@/components/ui/Button";
import { DocHeading, Facts, Files, Prose, Section, statusPill } from "@/components/documents/parts";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ payment?: string }> };

export const metadata: Metadata = { title: "Your order" };

const PAYMENT_NOTICES: Record<string, string> = {
  canceled: "Your payment wasn't completed, so nothing was charged. Your deposit is still due whenever you're ready.",
  error: "We couldn't open the secure payment page just now. Please try again in a moment, or contact us.",
  limited: "Too many attempts in a short time. Please wait a few minutes and try again.",
};

export default async function CustomerOrderPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { payment } = await searchParams;
  const o = await customerOrderView(token);
  if (!o) notFound();
  const canceled = o.productionStatus === "CANCELED";
  const step = CUSTOMER_PROGRESS.findIndex((s) => s.statuses.includes(o.productionStatus));

  return (
    <article>
      <DocHeading eyebrow="Order" title={o.number} status={statusPill(canceled ? "CANCELED" : o.productionStatus === "COMPLETED" ? "COMPLETED" : o.paymentStatus)}>
        <p className="mt-3 text-sm text-muted">Placed {siteDateLong(o.placedAt)}</p>
      </DocHeading>

      {payment && PAYMENT_NOTICES[payment] && o.deposit && !o.deposit.paid ? (
        <p role="status" className="mt-8 border-l-2 border-bronze bg-paper px-5 py-4">
          {PAYMENT_NOTICES[payment]}
        </p>
      ) : null}

      {o.deposit && !o.deposit.paid && !canceled ? (
        <section aria-labelledby="deposit-heading" className="mt-8 border border-charcoal bg-paper p-6 print:hidden md:p-8">
          <h2 id="deposit-heading" className="display-sm">
            {o.deposit.confirming ? "Confirming your deposit…" : "Deposit due"}
          </h2>
          <dl className="mt-4 max-w-sm space-y-1.5">
            <div className="flex justify-between gap-6">
              <dt>Order total</dt>
              <dd className="tabular-nums">{formatCents(o.totalCents, { showZeroCents: true })}</dd>
            </div>
            <div className="flex justify-between gap-6 font-semibold">
              <dt>Deposit due</dt>
              <dd className="tabular-nums">{formatCents(o.deposit.dueCents, { showZeroCents: true })}</dd>
            </div>
          </dl>
          {o.deposit.confirming ? (
            <p className="mt-4 text-muted">Stripe has your payment and is confirming it with us. This page will update shortly.</p>
          ) : o.deposit.payHref ? (
            <>
              {/* A plain link: the server opens a fresh, correctly priced Stripe Checkout each time. */}
              <a href={o.deposit.payHref} rel="nofollow" className={buttonClasses("primary", "lg", "mt-6")}>
                Pay {formatCents(o.deposit.dueCents, { showZeroCents: true })} Deposit
              </a>
              <p className="mt-3 text-xs text-muted">You&apos;ll pay on Stripe&apos;s secure page. Your card details are never stored by Wild Mountain.</p>
            </>
          ) : o.deposit.instructions ? (
            <div className="mt-4 whitespace-pre-line leading-relaxed text-charcoal-muted">{o.deposit.instructions}</div>
          ) : (
            <p className="mt-4 text-muted">We&apos;ll be in touch with payment details.</p>
          )}
        </section>
      ) : null}

      {canceled ? (
        <p role="note" className="mt-8 border-l-2 border-error bg-paper px-5 py-4">
          This order has been canceled. Please contact us with any questions.
        </p>
      ) : (
        <Section title="Progress">
          <ol className="grid gap-3 sm:grid-cols-7 sm:gap-2" aria-label="Order progress">
            {CUSTOMER_PROGRESS.map((s, i) => {
              const done = i < step || o.productionStatus === "COMPLETED";
              const current = i === step && o.productionStatus !== "COMPLETED";
              return (
                <li key={s.label} aria-current={current ? "step" : undefined} className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2">
                  <span className={cn("h-1.5 w-10 shrink-0 sm:w-full", done ? "bg-charcoal" : current ? "bg-bronze" : "bg-stone")} aria-hidden="true" />
                  <span className={cn("text-sm", current ? "font-semibold" : done ? "" : "text-muted")}>
                    {s.label}
                    <span className="sr-only">{done ? " (done)" : current ? " (current)" : ""}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </Section>
      )}

      <div className="mt-10">
        <Facts
          items={[
            { label: "Estimated completion", value: o.estimatedCompletion },
            { label: "Delivery", value: o.deliveryDate ? `${DELIVERY_STATUS_LABELS[o.deliveryStatus]} · ${siteDateLong(o.deliveryDate)}` : o.deliveryStatus !== "NOT_SCHEDULED" ? DELIVERY_STATUS_LABELS[o.deliveryStatus] : null },
            { label: "Delivery address", value: o.customer.address },
            { label: "Delivery notes", value: o.deliveryNotes },
            { label: "Payment", value: ORDER_PAYMENT_STATUS_LABELS[o.paymentStatus] },
          ]}
        />
      </div>

      <Section title="Your piece">
        <ul className="divide-y divide-stone border-y border-stone">
          {o.items.map((i, n) => (
            <li key={n} className="flex flex-wrap justify-between gap-3 py-4">
              <div>
                <p className="font-medium">
                  {i.description}
                  {i.quantity > 1 ? ` × ${i.quantity}` : ""}
                </p>
                {i.notes ? <p className="mt-1 whitespace-pre-line text-sm text-muted">{i.notes}</p> : null}
              </div>
              <p className="tabular-nums">{i.lineTotalCents < 0 ? `−${formatCents(-i.lineTotalCents)}` : formatCents(i.lineTotalCents)}</p>
            </li>
          ))}
        </ul>
        <dl className="ml-auto mt-6 w-full max-w-sm space-y-2">
          <div className="flex justify-between border-t border-charcoal pt-3 text-lg font-semibold">
            <dt>Order total</dt>
            <dd className="tabular-nums">{formatCents(o.totalCents, { showZeroCents: true })}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Paid</dt>
            <dd className="tabular-nums">{formatCents(o.paidCents, { showZeroCents: true })}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Remaining</dt>
            <dd className="tabular-nums">{formatCents(o.balanceCents, { showZeroCents: true })}</dd>
          </div>
        </dl>
      </Section>

      {o.invoices.length ? (
        <Section title="Invoices">
          <ul className="divide-y divide-stone border-y border-stone">
            {o.invoices.map((i) => (
              <li key={i.number} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  {i.number} · {INVOICE_KIND_LABELS[i.kind]} · {formatCents(i.totalCents)} · <span className="text-muted">{statusPill(i.status).label}</span>
                </span>
                <span className="flex flex-wrap gap-4">
                  {i.payUrl && i.amountDueCents > 0 ? (
                    <a href={i.payUrl} className={buttonClasses("primary", "md")} rel="noopener noreferrer">
                      Pay {formatCents(i.amountDueCents)}
                    </a>
                  ) : null}
                  {i.href ? (
                    <Link href={i.href} className={buttonClasses("text", "md")}>
                      View invoice
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
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
