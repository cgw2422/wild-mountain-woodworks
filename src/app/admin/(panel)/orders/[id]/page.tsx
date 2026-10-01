import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { siteDateInput } from "@/lib/site-time";
import { centsToDollarInput, formatCents } from "@/lib/money";
import { getSettings, salesFlags } from "@/lib/settings";
import { customerLinks } from "@/lib/sales/links";
import { orderMoney } from "@/lib/sales/orders";
import { DELIVERY_STATUSES, DELIVERY_STATUS_LABELS, INVOICE_KIND_LABELS, MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABELS, PRODUCTION_STATUSES, PRODUCTION_STATUS_LABELS } from "@/lib/sales/status";
import { ActionButton, ActionForm, ConfirmAction, MoneyInput, Select, SubmitButton, TextArea, TextInput, Toggle } from "@/components/admin/forms";
import { Badge, Card, DescriptionList, PageHeader, adminButton, formatDate, table } from "@/components/admin/ui";
import { NotesPanel } from "@/components/admin/inbox/NotesPanel";
import { StatusHistory } from "@/components/admin/inbox/StatusHistory";
import { LongText } from "@/components/admin/inbox/CustomerCard";
import { ImageField } from "@/components/admin/media/ImageField";
import { CopyButton } from "@/components/admin/sales/CopyButton";
import { EmailLogCard } from "@/components/admin/sales/EmailLogCard";
import { FormDialog } from "@/components/admin/sales/FormDialog";
import { VoidReasonFields } from "@/components/admin/sales/VoidReasonFields";
import { Money } from "@/components/admin/sales/Money";
import { RevisionLines } from "@/components/admin/sales/RevisionLines";
import { SalesBadge } from "@/components/admin/sales/SalesBadge";
import { cn } from "@/lib/cn";
import { addNoteAction } from "../../inbox-actions";
import {
  addSalesAttachmentAction,
  createOrderInvoiceAction,
  recordPaymentAction,
  removeSalesAttachmentAction,
  resendDepositLinkAction,
  setSalesAttachmentVisibilityAction,
  updateOrderAction,
  voidInvoiceAction,
} from "../../sales-actions";

type Props = { params: Promise<{ id: string }> };

const CHECKOUT_LABELS: Record<string, string> = {
  open: "Customer has an open checkout",
  complete: "Paid — confirmed by Stripe",
  processing: "Payment processing (bank payment)",
  expired: "Checkout expired — a new one opens automatically when the customer pays",
  failed: "Last payment attempt failed",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const o = await prisma.order.findUnique({ where: { id }, select: { number: true } });
  return { title: o ? `Order ${o.number}` : "Order not found" };
}

export default async function OrderDetailPage({ params }: Props) {
  const { id } = await params;
  const admin = await requirePermission("sales");
  const finance = can(admin.role, "finance");
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: { orderBy: { position: "asc" } },
      quote: { select: { id: true, number: true } },
      acceptedRevision: { select: { acceptedAt: true } },
      customer: { select: { id: true } },
      invoices: { orderBy: { createdAt: "asc" } },
      payments: { orderBy: { receivedAt: "asc" }, include: { invoice: { select: { number: true } } } },
      internalNotes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      statusEvents: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
      emails: { orderBy: { createdAt: "desc" }, take: 20 },
      files: { orderBy: { createdAt: "asc" }, include: { media: { select: { url: true, originalName: true } } } },
    },
  });
  if (!order) notFound();
  const money = orderMoney(order, order.payments);
  const live = order.invoices.filter((i) => i.status !== "VOID" && i.status !== "CANCELED");
  const invoiced = live.reduce((s, i) => s + i.totalCents, 0);
  const hasDepositInvoice = live.some((i) => i.kind === "DEPOSIT");
  const canceled = order.productionStatus === "CANCELED";
  const link = order.customerToken ? customerLinks.order(order.customerToken) : null;
  const online = salesFlags(await getSettings()).onlinePayments;
  const deposit = live.find((i) => i.kind === "DEPOSIT") ?? null;
  const depositDue = deposit ? Math.max(0, deposit.totalCents - deposit.amountPaidCents) : 0;
  const depositOpen = Boolean(deposit && depositDue > 0 && !["DRAFT", "PAID"].includes(deposit.status));
  const payLink = order.customerToken && deposit && online && !deposit.stripeHostedInvoiceUrl ? customerLinks.depositPay(order.customerToken) : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Orders", href: "/admin/orders" }, { label: order.number }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{order.number}</span>
            <SalesBadge status={order.productionStatus} />
            <SalesBadge status={order.paymentStatus} />
          </span>
        }
        description={`Placed ${formatDate(order.createdAt, true)}${order.quote?.number ? ` from quote ${order.quote.number}` : ""}`}
        actions={
          <>
            <a href={`/admin/work-order/${order.id}`} target="_blank" rel="noopener" className={adminButton.secondary}>
              Print work order
            </a>
            {link ? (
              <>
                <CopyButton value={link} label="Copy customer link" />
                <a href={link} target="_blank" rel="noopener noreferrer" className={adminButton.secondary}>
                  View as customer
                </a>
              </>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card title="Production & delivery">
            <ActionForm action={updateOrderAction.bind(null, order.id)} className="space-y-4" successMessage={null}>
              <div className="grid gap-4 md:grid-cols-2">
                <Select label="Production status" name="productionStatus" defaultValue={order.productionStatus} options={PRODUCTION_STATUSES.map((s) => ({ value: s, label: PRODUCTION_STATUS_LABELS[s] }))} />
                <TextInput label="Estimated completion" name="estimatedCompletion" defaultValue={order.estimatedCompletion ?? ""} maxLength={120} />
                <Select label="Delivery status" name="deliveryStatus" defaultValue={order.deliveryStatus} options={DELIVERY_STATUSES.map((s) => ({ value: s, label: DELIVERY_STATUS_LABELS[s] }))} />
                <TextInput label="Delivery date" name="deliveryDate" type="date" defaultValue={order.deliveryDate ? siteDateInput(order.deliveryDate) : ""} />
              </div>
              <TextInput label="Delivery address" name="deliveryAddress" defaultValue={order.deliveryAddress ?? ""} maxLength={300} />
              <TextArea label="Delivery notes (customer can see)" name="deliveryNotes" rows={2} defaultValue={order.deliveryNotes ?? ""} maxLength={1000} />
              <TextArea label="Notes to the customer (shown on their order page)" name="customerNotes" rows={2} defaultValue={order.customerNotes ?? ""} maxLength={5000} />
              <TextArea label="Shop notes (internal — printed on the work order)" name="productionNotes" rows={4} defaultValue={order.productionNotes ?? ""} maxLength={5000} />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-4">
                <Toggle name="notifyCustomer" label="Email the customer about this update" description="Progress, delivery date or completion — only when you choose." />
                <SubmitButton>Save order</SubmitButton>
              </div>
            </ActionForm>
          </Card>

          <Card title="Items" description="Copied from the accepted quote — later catalog or quote edits never change them.">
            <RevisionLines
              lines={order.items.map((i) => ({ id: i.id, kind: i.kind, description: i.description ?? i.productName, notes: i.notes, quantity: i.quantity, unitPriceCents: i.unitPriceCents, lineTotalCents: i.lineTotalCents }))}
              totals={{ subtotalCents: order.subtotalCents, discountCents: order.discountCents, deliveryCents: order.shippingCents, otherChargesCents: 0, taxCents: order.taxCents, totalCents: order.totalCents, depositCents: order.depositCents, balanceCents: order.totalCents - order.depositCents }}
            />
          </Card>

          {order.depositCents > 0 ? (
            <Card
              title="Deposit"
              description={
                payLink
                  ? "Collected online: the customer pays by card through Stripe Checkout right after accepting. Nothing to send — the order moves to Deposit Paid once Stripe confirms the payment."
                  : "Online payments are off — the customer was shown your payment instructions. Record the payment when it arrives."
              }
              actions={
                finance && depositOpen && deposit ? (
                  <div className="flex flex-wrap gap-2">
                    {payLink ? (
                      <>
                        <CopyButton value={payLink} label="Copy deposit payment link" variant="small" />
                        <a href={payLink} target="_blank" rel="noopener noreferrer" className={adminButton.small}>
                          Open payment
                        </a>
                        <ActionButton action={resendDepositLinkAction.bind(null, deposit.id)} variant="small" pendingLabel="Sending…">
                          Resend payment link
                        </ActionButton>
                      </>
                    ) : null}
                    <FormDialog
                      label="Mark manual payment"
                      title="Record a manual deposit payment"
                      description={`Still owed on the deposit: ${formatCents(depositDue)}. Any open online checkout is closed first, so the customer can't also pay by card.`}
                      action={recordPaymentAction.bind(null, deposit.id)}
                      submitLabel="Record payment"
                      variant="small"
                    >
                      <div className="grid gap-4 sm:grid-cols-2">
                        <MoneyInput label="Amount" name="amount" required defaultValue={centsToDollarInput(depositDue)} />
                        <Select label="Method" name="method" defaultValue="CHECK" options={MANUAL_PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
                        <TextInput label="Date received" name="receivedOn" type="date" required defaultValue={siteDateInput(new Date())} />
                        <TextInput label="Reference" name="reference" maxLength={120} placeholder="Check #, transfer ref…" />
                      </div>
                      <TextArea label="Notes" name="notes" rows={2} maxLength={1000} />
                      <Toggle label="Email the customer a receipt" name="sendReceipt" defaultChecked />
                    </FormDialog>
                    {deposit.amountPaidCents === 0 ? (
                      <FormDialog
                        label="Cancel payment request"
                        title="Cancel the deposit payment request?"
                        description="The deposit request is voided (kept for the record) and any open online checkout is closed, so the customer can no longer pay it. You can create a new request later."
                        action={voidInvoiceAction.bind(null, deposit.id)}
                        submitLabel="Cancel payment request"
                        variant="small"
                        submitVariant="danger"
                      >
                        <VoidReasonFields />
                      </FormDialog>
                    ) : null}
                  </div>
                ) : null
              }
            >
              <DescriptionList
                className="sm:grid-cols-[10rem_1fr]"
                items={[
                  { label: "Quote accepted", value: order.acceptedRevision?.acceptedAt ? formatDate(order.acceptedRevision.acceptedAt, true) : order.quote ? "Yes" : "—" },
                  { label: "Order created", value: formatDate(order.createdAt, true) },
                  { label: "Deposit due", value: <Money cents={order.depositCents} /> },
                  {
                    label: "Payment status",
                    value: !deposit ? (
                      <Badge tone="amber">No deposit request</Badge>
                    ) : depositDue <= 0 ? (
                      <Badge tone="green">Deposit paid</Badge>
                    ) : (
                      <span className="flex flex-wrap items-center gap-2">
                        <SalesBadge status={order.paymentStatus} />
                        {deposit.amountPaidCents > 0 ? <span className="text-sm text-neutral-600">{formatCents(deposit.amountPaidCents)} paid · {formatCents(depositDue)} to go</span> : null}
                      </span>
                    ),
                  },
                  ...(payLink && deposit
                    ? [
                        {
                          label: "Stripe Checkout",
                          value: (
                            <span className="text-sm">
                              {CHECKOUT_LABELS[deposit.stripeCheckoutStatus ?? ""] ?? "Not opened yet"}
                              {deposit.stripeCheckoutStatus === "open" && deposit.stripeCheckoutExpiresAt ? ` · expires ${formatDate(deposit.stripeCheckoutExpiresAt, true)}` : ""}
                              {deposit.checkoutAttempts > 1 ? ` · ${deposit.checkoutAttempts} sessions opened` : ""}
                            </span>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </Card>
          ) : null}

          <Card
            title="Invoices & payments"
            description={`${money.label}. Invoiced so far: ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(invoiced / 100)}.`}
            actions={
              finance && !canceled ? (
                <div className="flex flex-wrap gap-2">
                  {order.depositCents > 0 && !hasDepositInvoice ? (
                    <ActionButton action={createOrderInvoiceAction.bind(null, order.id, "DEPOSIT")} variant="small">
                      {online ? "New deposit payment request" : "Deposit invoice"}
                    </ActionButton>
                  ) : null}
                  {invoiced < order.totalCents && invoiced > 0 ? (
                    <ActionButton action={createOrderInvoiceAction.bind(null, order.id, "BALANCE")} variant="small">
                      Create final balance invoice
                    </ActionButton>
                  ) : null}
                  {invoiced === 0 ? (
                    <ActionButton action={createOrderInvoiceAction.bind(null, order.id, "FULL")} variant="small">
                      Full invoice
                    </ActionButton>
                  ) : null}
                  {order.customer ? (
                    <Link href={`/admin/invoices/new?customer=${order.customer.id}&order=${order.id}`} className={adminButton.small}>
                      Custom invoice
                    </Link>
                  ) : null}
                </div>
              ) : null
            }
            bodyClassName="p-0"
          >
            {order.invoices.length ? (
              <div className="relative overflow-x-auto">
                <table className={table.table}>
                  <thead className={table.thead}>
                    <tr>
                      <th scope="col" className={table.th}>Invoice</th>
                      <th scope="col" className={table.th}>Type</th>
                      <th scope="col" className={cn(table.th, "text-right")}>Total</th>
                      <th scope="col" className={cn(table.th, "text-right")}>Paid</th>
                      <th scope="col" className={table.th}>Due</th>
                      <th scope="col" className={table.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody className={table.tbody}>
                    {order.invoices.map((i) => (
                      <tr key={i.id}>
                        <td className={table.td}>
                          {finance ? (
                            <Link href={`/admin/invoices/${i.id}`} className="inline-block py-1 font-mono text-xs underline underline-offset-2">
                              {i.number}
                            </Link>
                          ) : (
                            <span className="font-mono text-xs">{i.number}</span>
                          )}
                        </td>
                        <td className={table.td}>{INVOICE_KIND_LABELS[i.kind]}</td>
                        <td className={cn(table.td, "text-right")}>
                          <Money cents={i.totalCents} />
                        </td>
                        <td className={cn(table.td, "text-right")}>
                          <Money cents={i.amountPaidCents} />
                        </td>
                        <td className={cn(table.td, "whitespace-nowrap")}>{formatDate(i.dueDate)}</td>
                        <td className={table.td}>
                          <SalesBadge status={i.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-5 py-4 text-sm text-neutral-500">No invoices yet.</p>
            )}
            {order.payments.length ? (
              <div className="border-t border-neutral-100 px-5 py-4">
                <h3 className="mb-2 text-sm font-semibold">Payments</h3>
                <ul className="space-y-1 text-sm">
                  {order.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap justify-between gap-2">
                      <span>
                        {formatDate(p.receivedAt)} · {PAYMENT_METHOD_LABELS[p.method]} · {p.invoice?.number}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </span>
                      <span className="flex items-center gap-2">
                        <Money cents={p.amountCents} />
                        {p.status !== "SUCCEEDED" ? <SalesBadge status={p.status} /> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          <Card
            title="Drawings & photos"
            actions={
              <FormDialog label="Attach" title="Attach a file" action={addSalesAttachmentAction.bind(null, "order", order.id)} submitLabel="Attach" variant="small">
                <ImageField name="mediaId" label="Image" value={null} slot="square" compact />
                <TextInput label="Label" name="label" maxLength={120} placeholder="e.g. Final design drawing" />
                <Toggle label="Visible to the customer" name="customerVisible" description="Shown on their order page." />
              </FormDialog>
            }
          >
            {order.files.length ? (
              <ul className="divide-y divide-neutral-100">
                {order.files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <a href={f.media.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                      {f.label || f.media.originalName}
                    </a>
                    <span className="flex items-center gap-2">
                      <Badge tone={f.customerVisible ? "green" : "neutral"}>{f.customerVisible ? "Customer can see" : "Internal"}</Badge>
                      <ActionButton action={setSalesAttachmentVisibilityAction.bind(null, f.id, !f.customerVisible)} variant="small">
                        {f.customerVisible ? "Hide" : "Show to customer"}
                      </ActionButton>
                      <ConfirmAction action={removeSalesAttachmentAction.bind(null, f.id)} label="Remove" title="Remove this file from the order?" body="The image stays in the media library." variant="small" confirmLabel="Remove" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">No files attached.</p>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card
            title="Customer"
            actions={
              order.customer ? (
                <Link href={`/admin/customers/${order.customer.id}`} className={adminButton.small}>
                  Customer page
                </Link>
              ) : null
            }
          >
            <DescriptionList
              className="sm:grid-cols-[5rem_1fr]"
              items={[
                { label: "Name", value: order.customerName },
                { label: "Email", value: <a href={`mailto:${order.customerEmail}`} className="underline underline-offset-2">{order.customerEmail}</a> },
                { label: "Phone", value: order.customerPhone },
                { label: "Address", value: order.deliveryAddress ? <LongText text={order.deliveryAddress} /> : null },
              ]}
            />
          </Card>
          <Card title="Money">
            <DescriptionList
              className="sm:grid-cols-[7rem_1fr]"
              items={[
                { label: "Order total", value: <Money cents={order.totalCents} /> },
                { label: "Deposit", value: <Money cents={order.depositCents} /> },
                { label: "Paid", value: <Money cents={money.paidCents} /> },
                { label: "Balance", value: <Money cents={money.balanceCents} className="font-semibold" /> },
              ]}
            />
          </Card>
          <Card title="History">
            <StatusHistory events={order.statusEvents} originLabel="Created from the accepted quote" />
          </Card>
          <NotesPanel notes={order.internalNotes} currentAdminId={admin.id} addAction={addNoteAction.bind(null, "order", order.id)} />
          <EmailLogCard emails={order.emails} />
        </div>
      </div>
    </>
  );
}
