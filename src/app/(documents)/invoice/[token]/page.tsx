import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCents } from "@/lib/money";
import { INVOICE_KIND_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/sales/status";
import { customerInvoiceView } from "@/lib/sales/views";
import { siteDateLong } from "@/lib/site-time";
import { buttonClasses } from "@/components/ui/Button";
import { DocHeading, Facts, LinesTable, Prose, Section, TotalsBlock, statusPill } from "@/components/documents/parts";
import { PrintButton } from "@/components/documents/PrintButton";

type Props = { params: Promise<{ token: string }> };

export const metadata: Metadata = { title: "Your invoice" };

/**
 * Invoice page (also the branded, printable invoice when Stripe invoicing is
 * off). With Stripe on, "Pay" goes to Stripe's hosted invoice page — card
 * details never touch this site.
 */
export default async function CustomerInvoicePage({ params }: Props) {
  const { token } = await params;
  const inv = await customerInvoiceView(token);
  if (!inv) notFound();
  const kind = INVOICE_KIND_LABELS[inv.kind];

  return (
    <article>
      <DocHeading eyebrow={`${kind === "Invoice" ? "Invoice" : `${kind} invoice`}`} title={inv.number} status={statusPill(inv.status)}>
        <p className="mt-3 text-sm text-muted">
          Issued {siteDateLong(inv.issuedAt)}
          {inv.dueDate && inv.amountDueCents > 0 && !inv.voided ? ` · Due ${siteDateLong(inv.dueDate)}` : null}
          {inv.paidAt ? ` · Paid ${siteDateLong(inv.paidAt)}` : null}
        </p>
      </DocHeading>

      {inv.voided ? (
        <p role="note" className="mt-8 border-l-2 border-error bg-paper px-5 py-4">
          This invoice has been voided and no payment is due.
        </p>
      ) : null}

      <div className="mt-10">
        <Facts
          items={[
            { label: "Billed to", value: `${inv.customer.name}\n${inv.customer.email}` },
            { label: "From", value: [inv.business.name, inv.business.email, inv.business.phone].filter(Boolean).join("\n") },
            { label: "Order", value: inv.orderNumber },
            { label: "Quote", value: inv.quoteNumber },
          ]}
        />
      </div>

      <Section title="Details">
        <LinesTable lines={inv.lines} />
        <TotalsBlock totals={inv.totals} extra={[...(inv.amountPaidCents ? [{ label: "Paid", cents: -inv.amountPaidCents }] : []), { label: "Amount due", cents: inv.voided ? 0 : inv.amountDueCents, strong: true }]} />
      </Section>

      {inv.customerNotes ? (
        <Section title="Notes">
          <Prose text={inv.customerNotes} />
        </Section>
      ) : null}

      {inv.payments.length ? (
        <Section title="Payments received">
          <ul className="divide-y divide-stone border-y border-stone">
            {inv.payments.map((p, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-3 py-3 text-[0.98rem]">
                <span>
                  {siteDateLong(p.receivedAt)} · {PAYMENT_METHOD_LABELS[p.method]}
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

      {inv.paymentInstructions && inv.amountDueCents > 0 ? (
        <Section title="How to pay">
          <Prose text={inv.paymentInstructions} />
        </Section>
      ) : null}

      <div className="mt-12 flex flex-col gap-3 sm:flex-row sm:flex-wrap print:hidden">
        {inv.payUrl && inv.amountDueCents > 0 ? (
          <a href={inv.payUrl} className={buttonClasses("primary", "lg")} rel="noopener noreferrer">
            Pay {formatCents(inv.amountDueCents, { showZeroCents: true })} securely
          </a>
        ) : null}
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
