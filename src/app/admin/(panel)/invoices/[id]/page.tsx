import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { centsToDollarInput } from "@/lib/money";
import { getSettings, salesFlags } from "@/lib/settings";
import { siteDateInput } from "@/lib/site-time";
import { customerLinks } from "@/lib/sales/links";
import { INVOICE_KIND_LABELS, MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/sales/status";
import type { LineKind } from "@/lib/sales/totals";
import { ActionButton, ConfirmAction, MoneyInput, Select, TextArea, TextInput, Toggle } from "@/components/admin/forms";
import { Card, DescriptionList, PageHeader, adminButton, formatDate, table } from "@/components/admin/ui";
import { NotesPanel } from "@/components/admin/inbox/NotesPanel";
import { StatusHistory } from "@/components/admin/inbox/StatusHistory";
import { CopyButton } from "@/components/admin/sales/CopyButton";
import { EmailLogCard } from "@/components/admin/sales/EmailLogCard";
import { FormDialog } from "@/components/admin/sales/FormDialog";
import { InvoiceEditor } from "@/components/admin/sales/InvoiceEditor";
import { Money } from "@/components/admin/sales/Money";
import { RevisionLines } from "@/components/admin/sales/RevisionLines";
import { SalesBadge } from "@/components/admin/sales/SalesBadge";
import { cn } from "@/lib/cn";
import { addNoteAction } from "../../inbox-actions";
import { recordPaymentAction, recordRefundAction, resendInvoiceAction, saveInvoiceDraftAction, sendInvoiceAction, voidInvoiceAction, voidPaymentAction } from "../../sales-actions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const i = await prisma.invoice.findUnique({ where: { id }, select: { number: true } });
  return { title: i ? `Invoice ${i.number}` : "Invoice not found" };
}

export default async function InvoiceDetailPage({ params }: Props) {
  const { id } = await params;
  const admin = await requirePermission("finance");
  const [invoice, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id },
      include: {
        lineItems: { orderBy: { position: "asc" } },
        order: { select: { id: true, number: true } },
        quote: { select: { id: true, number: true } },
        customer: { select: { id: true } },
        payments: { orderBy: { receivedAt: "asc" } },
        internalNotes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
        statusEvents: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
        emails: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    }),
    getSettings(),
  ]);
  if (!invoice) notFound();
  const flags = salesFlags(settings);
  const draft = invoice.status === "DRAFT";
  const closed = ["VOID", "CANCELED"].includes(invoice.status);
  const owed = invoice.totalCents - invoice.amountPaidCents;
  const link = invoice.publicToken ? customerLinks.invoice(invoice.publicToken) : null;
  const payLink = invoice.stripeHostedInvoiceUrl ?? link;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Invoices", href: "/admin/invoices" }, { label: invoice.number }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{invoice.number}</span>
            <SalesBadge status={invoice.status} />
          </span>
        }
        description={`${INVOICE_KIND_LABELS[invoice.kind]} invoice for ${invoice.customerName}${invoice.order ? ` · order ${invoice.order.number}` : ""}${invoice.sentAt ? ` · sent ${formatDate(invoice.sentAt, true)}` : ""}`}
        actions={
          <>
            {draft ? (
              <ConfirmAction
                action={sendInvoiceAction.bind(null, invoice.id)}
                label="Send invoice"
                title="Send this invoice?"
                body={
                  flags.stripeInvoicing ? (
                    <p>
                      It will be created and finalized in Stripe (hosted payment page and PDF), then {settings.invoiceEmailMode === "STRIPE" ? "emailed by Stripe" : "emailed by Wild Mountain with the payment link"}. Sent invoices can&apos;t be edited.
                    </p>
                  ) : (
                    <p>The customer is emailed a link to view it, with your payment instructions. Record payments here when they arrive. Sent invoices can&apos;t be edited.</p>
                  )
                }
                confirmLabel="Send invoice"
                variant="primary"
                confirmVariant="primary"
              />
            ) : null}
            {!draft && !closed && owed > 0 ? (
              <>
                <ActionButton action={resendInvoiceAction.bind(null, invoice.id, false)} pendingLabel="Sending…">
                  Resend
                </ActionButton>
                <ActionButton action={resendInvoiceAction.bind(null, invoice.id, true)} pendingLabel="Sending…">
                  Send reminder
                </ActionButton>
              </>
            ) : null}
            {!draft && payLink ? <CopyButton value={payLink} label={invoice.stripeHostedInvoiceUrl ? "Copy payment link" : "Copy invoice link"} /> : null}
            {!draft && link ? (
              <a href={link} target="_blank" rel="noopener noreferrer" className={adminButton.secondary}>
                View / print
              </a>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {draft ? (
            <InvoiceEditor
              action={saveInvoiceDraftAction.bind(null, invoice.id)}
              initial={{
                customerName: invoice.customerName,
                customerEmail: invoice.customerEmail,
                dueOn: invoice.dueDate ? siteDateInput(new Date(invoice.dueDate.getTime() - 1)) : "",
                customerNotes: invoice.customerNotes ?? "",
                lines: invoice.lineItems.map((l) => ({
                  key: l.id,
                  sourceId: null,
                  kind: l.kind as LineKind,
                  description: l.description,
                  notes: l.notes ?? "",
                  quantity: String(l.quantity),
                  price: centsToDollarInput(Math.abs(l.unitPriceCents)),
                  taxable: l.taxable,
                  productId: null,
                })),
              }}
            />
          ) : (
            <Card title="Invoice" description={closed ? `Voided ${formatDate(invoice.voidedAt, true)}${invoice.voidReason ? `: ${invoice.voidReason}` : ""}` : undefined}>
              <RevisionLines lines={invoice.lineItems} totals={invoice} extra={[{ label: "Paid", cents: -invoice.amountPaidCents }, { label: "Amount due", cents: closed ? 0 : owed }]} />
              {invoice.customerNotes ? <p className="mt-4 whitespace-pre-line text-sm text-neutral-700">{invoice.customerNotes}</p> : null}
            </Card>
          )}

          <Card
            title="Payments"
            description="Stripe payments appear automatically from verified webhooks. Record cash, check and bank transfers here."
            actions={
              !closed && owed > 0 ? (
                <FormDialog label="Record payment" title="Record a manual payment" description={`Still owed on this invoice: ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(owed / 100)}. This never creates anything in Stripe.`} action={recordPaymentAction.bind(null, invoice.id)} submitLabel="Record payment" variant="primary">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <MoneyInput label="Amount" name="amount" required defaultValue={centsToDollarInput(owed)} />
                    <Select label="Method" name="method" defaultValue="CHECK" options={MANUAL_PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
                    <TextInput label="Date received" name="receivedOn" type="date" required defaultValue={siteDateInput(new Date())} />
                    <TextInput label="Reference" name="reference" maxLength={120} placeholder="Check #, transfer ref…" />
                  </div>
                  <TextArea label="Notes" name="notes" rows={2} maxLength={1000} />
                  <Toggle label="Email the customer a receipt" name="sendReceipt" defaultChecked />
                </FormDialog>
              ) : null
            }
            bodyClassName="p-0"
          >
            {invoice.payments.length ? (
              <div className="relative overflow-x-auto">
                <table className={table.table}>
                  <thead className={table.thead}>
                    <tr>
                      <th scope="col" className={table.th}>Date</th>
                      <th scope="col" className={table.th}>Method</th>
                      <th scope="col" className={cn(table.th, "text-right")}>Amount</th>
                      <th scope="col" className={table.th}>Status</th>
                      <th scope="col" className={table.th}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className={table.tbody}>
                    {invoice.payments.map((p) => (
                      <tr key={p.id}>
                        <td className={cn(table.td, "whitespace-nowrap")}>{formatDate(p.receivedAt)}</td>
                        <td className={table.td}>
                          {PAYMENT_METHOD_LABELS[p.method]}
                          {p.reference ? <p className="text-xs text-neutral-500">{p.reference}</p> : null}
                          {p.stripePaymentIntentId ? <p className="font-mono text-xs text-neutral-500">{p.stripePaymentIntentId}</p> : null}
                          {p.voidReason ? <p className="text-xs text-neutral-500">Voided: {p.voidReason}</p> : null}
                        </td>
                        <td className={cn(table.td, "text-right")}>
                          <Money cents={p.amountCents} />
                          {p.refundedCents ? <p className="text-xs text-red-700">−<Money cents={p.refundedCents} /> refunded</p> : null}
                        </td>
                        <td className={table.td}>
                          <SalesBadge status={p.status} />
                        </td>
                        <td className={cn(table.td, "text-right")}>
                          <div className="flex justify-end gap-2">
                            {["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(p.status) ? (
                              <FormDialog label="Refund" title="Record a refund" description={p.source === "STRIPE" ? "Issue the refund in your Stripe dashboard — Stripe's webhook also updates this record. Use this only to record it here." : "Records money returned to the customer (cash, check or transfer). Nothing is deleted."} action={recordRefundAction.bind(null, p.id)} submitLabel="Record refund" variant="small" submitVariant="danger">
                                <MoneyInput label="Refund amount" name="amount" required defaultValue={centsToDollarInput(p.amountCents - p.refundedCents)} />
                                <TextInput label="Reason" name="reason" required maxLength={300} />
                              </FormDialog>
                            ) : null}
                            {p.source === "MANUAL" && p.status === "SUCCEEDED" ? (
                              <FormDialog label="Void" title="Void this payment?" description="For a payment entered by mistake. It stays in the history, marked void." action={voidPaymentAction.bind(null, p.id)} submitLabel="Void payment" variant="small" submitVariant="danger">
                                <TextInput label="Reason" name="reason" required maxLength={300} />
                              </FormDialog>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-5 py-4 text-sm text-neutral-500">No payments yet.</p>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="Summary">
            <DescriptionList
              className="sm:grid-cols-[7rem_1fr]"
              items={[
                { label: "Total", value: <Money cents={invoice.totalCents} /> },
                { label: "Paid", value: <Money cents={invoice.amountPaidCents} /> },
                { label: "Due", value: <Money cents={closed ? 0 : owed} className="font-semibold" /> },
                { label: "Due date", value: formatDate(invoice.dueDate) },
                { label: "Customer", value: invoice.customer ? <Link href={`/admin/customers/${invoice.customer.id}`} className="underline underline-offset-2">{invoice.customerName}</Link> : invoice.customerName },
                { label: "Order", value: invoice.order ? <Link href={`/admin/orders/${invoice.order.id}`} className="font-mono underline underline-offset-2">{invoice.order.number}</Link> : null },
                { label: "Quote", value: invoice.quote ? <Link href={`/admin/quotes/${invoice.quote.id}`} className="font-mono underline underline-offset-2">{invoice.quote.number}</Link> : null },
              ]}
            />
          </Card>
          <Card title="Stripe" description={flags.stripeInvoicing ? "Stripe invoicing is on." : "Stripe invoicing is off — invoices are sent and paid offline."}>
            {invoice.stripeInvoiceId ? (
              <div className="space-y-2 text-sm">
                <p className="font-mono text-xs">{invoice.stripeInvoiceId}</p>
                <p>Stripe status: {invoice.stripeStatus ?? "—"}</p>
                <div className="flex flex-wrap gap-2">
                  <a href={`https://dashboard.stripe.com/invoices/${encodeURIComponent(invoice.stripeInvoiceId)}`} target="_blank" rel="noopener noreferrer" className={adminButton.small}>
                    View in Stripe
                  </a>
                  {invoice.stripeHostedInvoiceUrl ? (
                    <a href={invoice.stripeHostedInvoiceUrl} target="_blank" rel="noopener noreferrer" className={adminButton.small}>
                      Hosted invoice
                    </a>
                  ) : null}
                  {invoice.stripeInvoicePdfUrl ? (
                    <a href={invoice.stripeInvoicePdfUrl} target="_blank" rel="noopener noreferrer" className={adminButton.small}>
                      PDF
                    </a>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-neutral-500">Not in Stripe.</p>
            )}
          </Card>
          {!closed && invoice.amountPaidCents === 0 ? (
            <Card title="Void">
              <FormDialog label="Void invoice" title="Void this invoice?" description={`It stays on record, marked void, and the customer's link shows it as void.${invoice.stripeInvoiceId ? " The Stripe invoice is voided too." : ""}`} action={voidInvoiceAction.bind(null, invoice.id)} submitLabel="Void invoice" variant="danger" submitVariant="danger">
                <TextInput label="Reason" name="reason" required maxLength={300} />
              </FormDialog>
            </Card>
          ) : null}
          <Card title="History">
            <StatusHistory events={invoice.statusEvents} originLabel="Created" />
          </Card>
          <NotesPanel notes={invoice.internalNotes} currentAdminId={admin.id} addAction={addNoteAction.bind(null, "invoice", invoice.id)} />
          <EmailLogCard emails={invoice.emails} />
        </div>
      </div>
    </>
  );
}
