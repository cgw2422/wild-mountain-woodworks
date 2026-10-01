import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { centsToDollarInput, formatCents } from "@/lib/money";
import { getSettings, salesFlags } from "@/lib/settings";
import { siteDateInput } from "@/lib/site-time";
import { invoiceMoney } from "@/lib/sales/ledger";
import { customerLinks } from "@/lib/sales/links";
import { INVOICE_KIND_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_TYPE_LABELS, paymentStatusLabel } from "@/lib/sales/status";
import { listTerminalReaders, terminalTestMode } from "@/lib/sales/terminal";
import type { LineKind } from "@/lib/sales/totals";
import { ActionButton, ConfirmAction, MoneyInput, Select, TextInput } from "@/components/admin/forms";
import { Badge, Card, DescriptionList, PageHeader, adminButton, formatDate, table } from "@/components/admin/ui";
import { NotesPanel } from "@/components/admin/inbox/NotesPanel";
import { StatusHistory } from "@/components/admin/inbox/StatusHistory";
import { CopyButton } from "@/components/admin/sales/CopyButton";
import { EmailLogCard } from "@/components/admin/sales/EmailLogCard";
import { FormDialog } from "@/components/admin/sales/FormDialog";
import { InvoiceEditor } from "@/components/admin/sales/InvoiceEditor";
import { Money } from "@/components/admin/sales/Money";
import { RecordPaymentFields } from "@/components/admin/sales/RecordPaymentFields";
import { RevisionLines } from "@/components/admin/sales/RevisionLines";
import { SalesBadge } from "@/components/admin/sales/SalesBadge";
import { VoidReasonFields } from "@/components/admin/sales/VoidReasonFields";
import { cn } from "@/lib/cn";
import { addNoteAction } from "../../inbox-actions";
import {
  cancelTerminalPaymentAction,
  markBalanceDueAction,
  markCheckClearedAction,
  markCheckReturnedAction,
  recordPaymentAction,
  recordRefundAction,
  refreshTerminalPaymentAction,
  resendDepositLinkAction,
  resendInvoiceAction,
  saveInvoiceDraftAction,
  sendInvoiceAction,
  simulateTerminalPaymentAction,
  startTerminalPaymentAction,
  voidInvoiceAction,
  voidPaymentAction,
} from "../../sales-actions";

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
        order: { select: { id: true, number: true, productionStatus: true, customerToken: true } },
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
  const closed = ["VOIDED", "CANCELED"].includes(invoice.status);
  const canceledOrder = invoice.order?.productionStatus === "CANCELED";
  const money = invoiceMoney(invoice);
  const canCollect = !draft && !closed && !canceledOrder && money.collectibleCents > 0;
  const link = invoice.publicToken ? customerLinks.invoice(invoice.publicToken) : null;
  const payLink = invoice.publicToken ? customerLinks.invoicePay(invoice.publicToken) : null;
  const staffIds = [...new Set([invoice.voidedById, invoice.balanceRequestedById, ...invoice.payments.flatMap((p) => [p.recordedById, p.voidedById])].filter((x): x is string => Boolean(x)))];
  const staff = new Map((await prisma.adminUser.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const pendingTerminal = invoice.payments.find((p) => p.method === "STRIPE_TERMINAL" && p.status === "PENDING");
  const terminal = flags.stripeConfigured && canCollect && !pendingTerminal ? await listTerminalReaders() : null;
  const testMode = terminalTestMode();

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
        description={`${INVOICE_KIND_LABELS[invoice.kind]} for ${invoice.customerName}${invoice.order ? ` · order ${invoice.order.number}` : ""}${invoice.sentAt ? ` · issued ${formatDate(invoice.sentAt, true)}` : ""}`}
        actions={
          <>
            {draft ? (
              <ConfirmAction
                action={sendInvoiceAction.bind(null, invoice.id)}
                label="Send invoice"
                title="Send this invoice?"
                body={<p>The customer is emailed a link to their Wild Mountain Woodworks invoice page, where they can pay (online through Stripe when it&apos;s on). Sent invoices can&apos;t be edited.</p>}
                confirmLabel="Send invoice"
                variant="primary"
                confirmVariant="primary"
              />
            ) : null}
            {!draft && !closed ? (
              <ActionButton action={resendInvoiceAction.bind(null, invoice.id, false)} pendingLabel="Sending…">
                {money.remainingCents > 0 ? "Send / resend invoice link" : "Email invoice"}
              </ActionButton>
            ) : null}
            {!draft && link ? <CopyButton value={link} label="Copy invoice link" /> : null}
            {!draft && link ? (
              <a href={link} target="_blank" rel="noopener noreferrer" className={adminButton.secondary}>
                Print / download
              </a>
            ) : null}
          </>
        }
      />
      {closed ? (
        <div role="alert" className="mb-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-semibold">VOIDED — this invoice can no longer be paid.</p>
          <p className="mt-1">
            {invoice.voidedAt ? `Voided ${formatDate(invoice.voidedAt, true)}` : "Voided"}
            {invoice.voidedById ? ` by ${staff.get(invoice.voidedById) ?? "staff"}` : ""}
            {invoice.voidReason ? ` · Reason: ${invoice.voidReason}` : ""}. Its number, lines, payments and Stripe records are kept.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {!draft ? (
            <Card
              title="Balance"
              description={
                invoice.balanceDueAt
                  ? `Final balance requested ${formatDate(invoice.balanceDueAt, true)}${invoice.balanceRequestedById ? ` by ${staff.get(invoice.balanceRequestedById) ?? "staff"}` : ""}.`
                  : money.depositCents > 0 && money.paidCents < money.depositCents
                    ? "Waiting on the deposit."
                    : money.remainingCents > 0
                      ? "When the piece is nearly ready, Mark balance due — the customer is emailed a link to this invoice and pays the remaining balance online."
                      : undefined
              }
              actions={
                canCollect && !invoice.balanceDueAt ? (
                  <ConfirmAction
                    action={markBalanceDueAction.bind(null, invoice.id)}
                    label="Mark balance due"
                    title={`Request the final balance of ${formatCents(money.remainingCents)}?`}
                    body={<p>The invoice stays the same — it becomes “Balance due” and the customer is emailed a link to this invoice, where they can pay the remaining balance. No new invoice is created.</p>}
                    confirmLabel="Mark balance due & email"
                    variant="primary"
                    confirmVariant="primary"
                  />
                ) : null
              }
            >
              <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Invoice total" cents={money.totalCents} />
                <Stat label="Deposit required" cents={money.depositCents} />
                <Stat label="Paid" cents={money.paidCents} />
                <Stat label="Pending" cents={money.pendingCents} muted={!money.pendingCents} />
                <Stat label="Remaining" cents={closed ? 0 : money.remainingCents} strong />
                <Stat label="Due now" cents={closed ? 0 : money.dueNowCents} muted={!money.dueNowCents} />
              </dl>
              {!closed && !canceledOrder && money.dueNowCents > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-neutral-100 pt-4">
                  {payLink && flags.onlinePayments ? <CopyButton value={payLink} label="Copy payment link" variant="small" /> : null}
                  {payLink && flags.onlinePayments ? (
                    <a href={payLink} target="_blank" rel="noopener noreferrer" className={adminButton.small}>
                      Pay online (Stripe)
                    </a>
                  ) : null}
                  <ActionButton action={resendDepositLinkAction.bind(null, invoice.id)} variant="small" pendingLabel="Sending…">
                    Email payment link
                  </ActionButton>
                </div>
              ) : null}
            </Card>
          ) : null}

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
            <Card title="Invoice">
              <RevisionLines lines={invoice.lineItems} totals={invoice} extra={[{ label: "Paid", cents: -invoice.amountPaidCents }, { label: "Remaining", cents: closed ? 0 : money.remainingCents }]} />
              {invoice.customerNotes ? <p className="mt-4 whitespace-pre-line text-sm text-neutral-700">{invoice.customerNotes}</p> : null}
            </Card>
          )}

          <Card
            title="Payments"
            description="Every payment on this invoice. Online and in-person card payments are recorded only when Stripe confirms them; cash, checks and transfers are recorded here and never touch Stripe."
            actions={
              canCollect ? (
                <div className="flex flex-wrap gap-2">
                  <FormDialog
                    label="Record payment"
                    title="Record a payment"
                    description={`Remaining: ${formatCents(money.remainingCents)}${money.pendingCents ? ` (${formatCents(money.pendingCents)} pending)` : ""}. Cash, check, bank transfer or other — nothing is created in Stripe.`}
                    action={recordPaymentAction.bind(null, invoice.id)}
                    submitLabel="Record payment"
                    variant="primary"
                  >
                    <RecordPaymentFields defaultAmount={centsToDollarInput(money.collectibleCents)} today={siteDateInput(new Date())} adminName={admin.name} canOverpay={admin.role === "OWNER"} />
                  </FormDialog>
                  {flags.stripeConfigured ? (
                    <FormDialog
                      label="Take in-person card payment"
                      title="In-person card payment (Stripe Terminal)"
                      description="Sends the amount to your Stripe Terminal reader; the customer taps, inserts or swipes their card there. It's recorded once Stripe confirms the payment — never before."
                      action={startTerminalPaymentAction.bind(null, invoice.id)}
                      submitLabel="Send to reader"
                    >
                      {terminal?.error ? <p className="mb-3 rounded bg-amber-50 p-3 text-sm text-amber-900">Couldn&apos;t load readers from Stripe: {terminal.error}</p> : null}
                      <div className="grid gap-4 sm:grid-cols-2">
                        <MoneyInput label="Amount" name="amount" required defaultValue={centsToDollarInput(money.collectibleCents)} help={`Up to ${formatCents(money.collectibleCents)}; a smaller partial payment is fine.`} />
                        {terminal?.readers.length ? (
                          <Select
                            label="Reader"
                            name="readerId"
                            defaultValue={settings.terminalReaderId ?? terminal.readers[0]!.id}
                            options={terminal.readers.map((r) => ({ value: r.id, label: `${r.label}${r.status ? ` (${r.status})` : ""}` }))}
                          />
                        ) : (
                          <TextInput label="Reader" name="readerId" defaultValue={settings.terminalReaderId ?? ""} help="Choose a default reader in Settings → Payments." />
                        )}
                      </div>
                    </FormDialog>
                  ) : null}
                </div>
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
                      <th scope="col" className={cn(table.th, "text-right")}>Amount</th>
                      <th scope="col" className={table.th}>Method</th>
                      <th scope="col" className={table.th}>Purpose</th>
                      <th scope="col" className={table.th}>Status</th>
                      <th scope="col" className={table.th}>Reference</th>
                      <th scope="col" className={table.th}>By</th>
                      <th scope="col" className={table.th}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className={table.tbody}>
                    {invoice.payments.map((p) => (
                      <tr key={p.id} className={cn(table.tr, ["VOIDED", "FAILED", "RETURNED"].includes(p.status) && "text-neutral-400")}>
                        <td className={cn(table.td, "whitespace-nowrap")}>{formatDate(p.receivedAt)}</td>
                        <td className={cn(table.td, "whitespace-nowrap text-right")}>
                          <Money cents={p.amountCents} />
                          {p.refundedCents ? <p className="text-xs text-neutral-500">refunded {formatCents(p.refundedCents)}</p> : null}
                        </td>
                        <td className={table.td}>{PAYMENT_METHOD_LABELS[p.method]}</td>
                        <td className={table.td}>{PAYMENT_TYPE_LABELS[p.type]}</td>
                        <td className={table.td}>
                          <Badge tone={p.status === "SUCCEEDED" ? "green" : p.status === "PENDING" ? "amber" : ["FAILED", "RETURNED", "VOIDED"].includes(p.status) ? "red" : "neutral"}>{paymentStatusLabel(p.method, p.status)}</Badge>
                          {p.failureMessage ? <p className="mt-1 max-w-[16rem] text-xs text-neutral-500">{p.failureMessage}</p> : null}
                          {p.voidReason ? (
                            <p className="mt-1 max-w-[16rem] text-xs text-neutral-500">
                              {p.status === "RETURNED" ? "Returned" : "Voided"}
                              {p.voidedById ? ` by ${staff.get(p.voidedById) ?? "staff"}` : ""}: {p.voidReason}
                            </p>
                          ) : null}
                        </td>
                        <td className={cn(table.td, "text-xs")}>
                          {p.method === "CHECK" && p.reference ? `Check #${p.reference}` : (p.reference ?? "—")}
                          {p.payerName ? <p className="text-neutral-500">{p.payerName}</p> : null}
                          {p.notes ? <p className="mt-1 whitespace-pre-line text-neutral-500">{p.notes}</p> : null}
                        </td>
                        <td className={cn(table.td, "text-xs")}>
                          {p.recordedById ? (staff.get(p.recordedById) ?? "Staff") : p.source === "STRIPE" ? "Stripe" : "—"}
                          {p.receivedBy && p.receivedBy !== staff.get(p.recordedById ?? "") ? <p className="text-neutral-500">received by {p.receivedBy}</p> : null}
                        </td>
                        <td className={table.td}>
                          <div className="flex flex-wrap justify-end gap-2">
                            {p.method === "CHECK" && p.status === "PENDING" ? (
                              <ConfirmAction action={markCheckClearedAction.bind(null, p.id)} label="Mark cleared" title="Mark this check cleared?" body="It then counts toward the balance, and the customer is emailed a receipt." confirmLabel="Mark cleared" variant="small" confirmVariant="primary" />
                            ) : null}
                            {p.method === "CHECK" && (p.status === "PENDING" || p.status === "SUCCEEDED") && p.refundedCents === 0 ? (
                              <FormDialog label="Returned" title="Mark this check returned?" description="For a bounced check. It stays in the history, marked returned, and no longer counts." action={markCheckReturnedAction.bind(null, p.id)} submitLabel="Mark returned" variant="small" submitVariant="danger">
                                <TextInput label="Reason" name="reason" required maxLength={300} defaultValue="Insufficient funds" />
                              </FormDialog>
                            ) : null}
                            {p.method === "STRIPE_TERMINAL" && p.status === "PENDING" ? (
                              <>
                                <ActionButton action={refreshTerminalPaymentAction.bind(null, p.id)} variant="small" pendingLabel="Checking…">
                                  Check status
                                </ActionButton>
                                {testMode ? (
                                  <ActionButton action={simulateTerminalPaymentAction.bind(null, p.id)} variant="small" pendingLabel="Simulating…">
                                    Simulate card (test)
                                  </ActionButton>
                                ) : null}
                                <ConfirmAction action={cancelTerminalPaymentAction.bind(null, p.id)} label="Cancel" title="Cancel this in-person payment?" body="The reader stops waiting for a card. If Stripe already approved it, it's recorded instead." confirmLabel="Cancel payment" variant="small" />
                              </>
                            ) : null}
                            {["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(p.status) ? (
                              <FormDialog
                                label="Refund"
                                title="Record a refund"
                                description={p.source === "STRIPE" ? "Issue the refund in your Stripe dashboard — Stripe's webhook also updates this record. Use this only to record it here." : "Records money returned to the customer (cash, check or transfer). Nothing is deleted."}
                                action={recordRefundAction.bind(null, p.id)}
                                submitLabel="Record refund"
                                variant="small"
                                submitVariant="danger"
                              >
                                <MoneyInput label="Refund amount" name="amount" required defaultValue={centsToDollarInput(p.amountCents - p.refundedCents)} />
                                <TextInput label="Reason" name="reason" required maxLength={300} />
                              </FormDialog>
                            ) : null}
                            {p.source === "MANUAL" && ["SUCCEEDED", "PENDING"].includes(p.status) && p.refundedCents === 0 ? (
                              <FormDialog
                                label="Void"
                                title="Void this payment?"
                                description={`For an entry made by mistake (${formatCents(p.amountCents)} ${PAYMENT_METHOD_LABELS[p.method].toLowerCase()}). It stays in the history, marked void, with your name and reason. Record the correct amount afterwards if needed.`}
                                action={voidPaymentAction.bind(null, p.id)}
                                submitLabel="Void payment"
                                variant="small"
                                submitVariant="danger"
                              >
                                <TextInput label="Reason" name="reason" required maxLength={300} placeholder="e.g. Entered $500 instead of $50" />
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

        <div className="space-y-6">
          <Card title="Details">
            <DescriptionList
              className="sm:grid-cols-[6rem_1fr]"
              items={[
                { label: "Total", value: <Money cents={invoice.totalCents} /> },
                { label: "Paid", value: <Money cents={invoice.amountPaidCents} /> },
                { label: "Remaining", value: <Money cents={closed ? 0 : money.remainingCents} className="font-semibold" /> },
                { label: "Customer", value: invoice.customer ? <Link href={`/admin/customers/${invoice.customer.id}`} className="underline underline-offset-2">{invoice.customerName}</Link> : invoice.customerName },
                { label: "Order", value: invoice.order ? <Link href={`/admin/orders/${invoice.order.id}`} className="font-mono underline underline-offset-2">{invoice.order.number}</Link> : null },
                { label: "Quote", value: invoice.quote ? <Link href={`/admin/quotes/${invoice.quote.id}`} className="font-mono underline underline-offset-2">{invoice.quote.number}</Link> : null },
              ]}
            />
          </Card>
          <Card title="Stripe" description={flags.onlinePayments ? "Online payments are on: customers pay what's due through Stripe Checkout from the invoice page." : "Online payments are off — payments are recorded here."}>
            <div className="space-y-2 text-sm">
              {invoice.stripeCheckoutSessionId ? (
                <p>
                  Latest checkout: <span className="font-mono text-xs">{invoice.stripeCheckoutSessionId}</span> ({invoice.stripeCheckoutStatus ?? "—"})
                </p>
              ) : (
                <p className="text-neutral-500">No online checkout opened yet.</p>
              )}
              {invoice.stripeInvoiceId ? (
                <div className="space-y-2 border-t border-neutral-100 pt-2">
                  <p>
                    Older Stripe invoice <span className="font-mono text-xs">{invoice.stripeInvoiceId}</span> ({invoice.stripeStatus ?? "—"})
                  </p>
                  <a href={`https://dashboard.stripe.com/invoices/${encodeURIComponent(invoice.stripeInvoiceId)}`} target="_blank" rel="noopener noreferrer" className={adminButton.small}>
                    View in Stripe
                  </a>
                </div>
              ) : null}
            </div>
          </Card>
          {!closed ? (
            <Card title="Void invoice" description="Invoices are never deleted. Voiding keeps it (with its number, lines and history) but it can no longer be paid.">
              {invoice.amountPaidCents === 0 && invoice.pendingCents === 0 ? (
                <FormDialog
                  label="Void invoice"
                  title={`Void invoice ${invoice.number}?`}
                  description={`This invoice will remain in history but can no longer be paid.${invoice.stripeInvoiceId ? " The Stripe invoice is voided too." : ""}${invoice.stripeCheckoutSessionId ? " Any open online checkout is closed." : ""} Its number is never reused.`}
                  action={voidInvoiceAction.bind(null, invoice.id)}
                  submitLabel="Void invoice"
                  variant="danger"
                  submitVariant="danger"
                >
                  <VoidReasonFields />
                </FormDialog>
              ) : (
                <p className="text-sm text-neutral-600">
                  {invoice.pendingCents > 0
                    ? "A payment is pending (a check to clear or a card on the reader). Resolve it before voiding."
                    : "Money has been received on this invoice, so it can't be voided — that would make the payment history inconsistent. Record a refund for each payment (or void a mistaken manual entry) first."}
                </p>
              )}
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

function Stat({ label, cents, strong, muted }: { label: string; cents: number; strong?: boolean; muted?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className={cn("mt-0.5 tabular-nums", strong ? "text-lg font-semibold text-neutral-900" : muted ? "text-neutral-400" : "text-neutral-900")}>{formatCents(cents, { showZeroCents: true })}</dd>
    </div>
  );
}
