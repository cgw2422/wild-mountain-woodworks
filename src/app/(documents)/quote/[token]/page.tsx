import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentAdmin } from "@/lib/auth/session";
import { formatCents } from "@/lib/money";
import { recordQuoteView } from "@/lib/sales/quotes";
import { loadCustomerQuote } from "@/lib/sales/views";
import { siteDateLong } from "@/lib/site-time";
import { buttonClasses } from "@/components/ui/Button";
import { DocHeading, Facts, Files, LinesTable, Prose, Section, TotalsBlock, statusPill } from "@/components/documents/parts";
import { PrintButton } from "@/components/documents/PrintButton";
import { QuoteResponse } from "@/components/documents/QuoteResponse";
import { FinancingNotice } from "@/components/payments/PaymentOptions";
import { acceptQuoteAction, declineQuoteAction } from "./actions";

type Props = { params: Promise<{ token: string }> };

export const metadata: Metadata = { title: "Your quote" };

/** Expiration dates are stored as the instant after the last valid day. */
const lastDay = (d: Date) => siteDateLong(new Date(d.getTime() - 1));

export default async function CustomerQuotePage({ params }: Props) {
  const { token } = await params;
  const loaded = await loadCustomerQuote(token);
  if (!loaded) notFound();
  const { view: q, internal } = loaded;

  // Record the customer's first view (not when staff open the link).
  if (internal.revisionId && internal.revisionStatus === "SENT" && !(await getCurrentAdmin())) {
    await recordQuoteView(internal.quoteId, internal.revisionId, { ip: null, userAgent: null });
  }

  const rev = q.revision;
  const contactHref = `/contact?reason=EXISTING_QUOTE&quote=${encodeURIComponent(q.number)}`;

  // A voided quote stays readable for the customer's records, but nothing on it can be accepted or paid.
  const voidedNotice = q.voided ? (
    <div role="alert" className="mt-8 border border-error/40 bg-paper px-5 py-5 md:px-6">
      <p className="text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-error">Quote voided</p>
      <p className="mt-2 text-[0.98rem]">
        This quote is no longer valid. Please{" "}
        <Link href={contactHref} className="underline underline-offset-2">
          contact {q.business.name}
        </Link>{" "}
        if you need an updated quote.
      </p>
    </div>
  ) : null;

  if (!rev) {
    if (q.voided) {
      return (
        <>
          <DocHeading eyebrow={`Quote ${q.number}`} title="This quote is no longer valid" status={statusPill(q.status)} />
          {voidedNotice}
        </>
      );
    }
    return (
      <>
        <DocHeading eyebrow={`Quote ${q.number}`} title="We're preparing your quote" />
        <p className="lede mt-8 max-w-2xl text-muted">Thank you for your request. We review every request personally and will email you when your quote is ready to view here.</p>
        <Link href={contactHref} className={buttonClasses("secondary", "md", "mt-8")}>
          Contact Us
        </Link>
      </>
    );
  }

  const accepted = rev.status === "ACCEPTED" && !q.voided;
  const depositInvoice = q.invoices.find((i) => i.kind === "DEPOSIT");
  return (
    <article>
      <DocHeading eyebrow={`Quote ${q.number}${rev.number > 1 ? ` · Revision ${rev.number}` : ""}`} title={`Prepared for ${rev.customer.name}`} status={statusPill(q.status)}>
        <p className="mt-3 text-sm text-muted">
          {rev.sentAt ? `Issued ${siteDateLong(rev.sentAt)}` : null}
          {rev.expiresAt && !accepted ? ` · Valid through ${lastDay(rev.expiresAt)}` : null}
        </p>
      </DocHeading>

      {voidedNotice}
      {q.blocker && !accepted && !q.voided ? (
        <p role="note" className="mt-8 border-l-2 border-bronze bg-paper px-5 py-4 text-[0.98rem]">
          {q.blocker}{" "}
          <Link href={contactHref} className="underline underline-offset-2">
            Contact us
          </Link>
        </p>
      ) : null}
      {accepted ? (
        <div role="note" className="mt-8 border-l-2 border-success bg-paper px-5 py-4">
          <p>
            Accepted by {rev.acceptedName}
            {rev.acceptedAt ? ` on ${siteDateLong(rev.acceptedAt)}` : ""}. Thank you!
          </p>
          {q.order ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {depositInvoice?.payUrl && depositInvoice.amountDueCents > 0 ? (
                <a href={depositInvoice.payUrl} className={buttonClasses("primary", "md")} rel="nofollow noopener noreferrer">
                  Pay {formatCents(depositInvoice.amountDueCents)} Deposit
                </a>
              ) : null}
              <Link href={`/order/${q.order.token}`} className={buttonClasses("text", "md")}>
                View order {q.order.number}
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-10">
        <Facts
          items={[
            { label: "Customer", value: [rev.customer.name, rev.customer.email, rev.customer.phone].filter(Boolean).join("\n") },
            { label: "Delivery address", value: rev.customer.address },
            { label: "Lead time", value: rev.leadTime },
            { label: "Estimated completion", value: rev.estimatedCompletion },
            { label: "Delivery", value: rev.deliveryDetails },
          ]}
        />
      </div>

      <Section title="Your quote">
        <LinesTable lines={rev.lines} />
        <TotalsBlock
          totals={rev.totals}
          extra={rev.depositCents > 0 ? [{ label: rev.depositLabel.replace(/ \(.+\)$/, ""), cents: rev.depositCents }, { label: "Balance before delivery", cents: rev.balanceCents }] : []}
        />
      </Section>

      {rev.customerNotes ? (
        <Section title="Notes">
          <Prose text={rev.customerNotes} />
        </Section>
      ) : null}

      {q.files.length ? (
        <Section title="Drawings & photos">
          <Files files={q.files} />
        </Section>
      ) : null}

      {rev.terms ? (
        <Section title="Terms">
          <Prose text={rev.terms} />
        </Section>
      ) : null}

      {q.invoices.length ? (
        <Section title="Invoices" className="print:hidden">
          <ul className="divide-y divide-stone border-y border-stone">
            {q.invoices.map((i) => (
              <li key={i.number} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  {i.number} · {formatCents(i.totalCents)} · <span className="text-muted">{statusPill(i.status).label}</span>
                </span>
                <span className="flex gap-4">
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

      <div className="mt-12 space-y-6">
        {!q.blocker ? (
          <QuoteResponse
            revision={rev.number}
            totalCents={rev.totals.totalCents}
            depositCents={rev.depositCents}
            balanceCents={rev.balanceCents}
            depositLabel={rev.depositLabel}
            onlinePayments={q.onlinePayments}
            paymentNotice={
              <FinancingNotice
                messaging={q.paymentMessaging}
                stripe={q.stripePublishableKey && rev.depositCents > 0 ? { publishableKey: q.stripePublishableKey, amountCents: rev.depositCents } : null}
              />
            }
            customerName={rev.customer.name}
            contactHref={contactHref}
            accept={acceptQuoteAction.bind(null, token)}
            decline={declineQuoteAction.bind(null, token)}
          />
        ) : null}
        <div className="flex flex-wrap gap-3 print:hidden">
          <PrintButton />
          {q.blocker ? (
            <Link href={contactHref} className={buttonClasses("secondary", "md")}>
              Contact Us
            </Link>
          ) : null}
        </div>
      </div>
      <p className="mt-10 hidden text-xs text-muted print:block">
        {q.business.name}
        {q.business.email ? ` · ${q.business.email}` : ""}
        {q.business.phone ? ` · ${q.business.phone}` : ""}
      </p>
    </article>
  );
}
