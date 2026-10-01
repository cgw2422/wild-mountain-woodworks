import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { formatCents } from "@/lib/money";
import { siteDateInput } from "@/lib/site-time";
import { invoiceMoney } from "@/lib/sales/ledger";
import { customerLinks } from "@/lib/sales/links";
import { orderMoney } from "@/lib/sales/orders";
import {
  DELIVERY_METHODS,
  DELIVERY_METHOD_LABELS,
  INVOICE_KIND_LABELS,
  NOTIFY_PRODUCTION_STATUSES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_TYPE_LABELS,
  PRODUCTION_STATUSES,
  PRODUCTION_STATUS_HELP,
  PRODUCTION_STATUS_LABELS,
  paymentStatusLabel,
  statusLabel,
} from "@/lib/sales/status";
import { ActionButton, ActionForm, ConfirmAction, SubmitButton, TextArea, TextInput, Toggle } from "@/components/admin/forms";
import { Badge, Card, DescriptionList, PageHeader, adminButton, formatDate } from "@/components/admin/ui";
import { NotesPanel } from "@/components/admin/inbox/NotesPanel";
import { StatusHistory } from "@/components/admin/inbox/StatusHistory";
import { LongText } from "@/components/admin/inbox/CustomerCard";
import { ImageField } from "@/components/admin/media/ImageField";
import { CopyButton } from "@/components/admin/sales/CopyButton";
import { EmailLogCard } from "@/components/admin/sales/EmailLogCard";
import { FormDialog } from "@/components/admin/sales/FormDialog";
import { Money } from "@/components/admin/sales/Money";
import { OrderStatusFields } from "@/components/admin/sales/OrderStatusFields";
import { RevisionLines } from "@/components/admin/sales/RevisionLines";
import { SalesBadge } from "@/components/admin/sales/SalesBadge";
import { cn } from "@/lib/cn";
import { addNoteAction } from "../../inbox-actions";
import {
  addSalesAttachmentAction,
  createOrderInvoiceAction,
  markBalanceDueAction,
  removeSalesAttachmentAction,
  resendDepositLinkAction,
  resendStatusEmailAction,
  setSalesAttachmentVisibilityAction,
  updateOrderAction,
} from "../../sales-actions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const o = await prisma.order.findUnique({ where: { id }, select: { number: true } });
  return { title: o ? `Order ${o.number}` : "Order not found" };
}

const NOTIFICATION_TONES: Record<string, "green" | "red" | "neutral" | "amber"> = { SENT: "green", FAILED: "red", SUPPRESSED: "neutral", SKIPPED: "neutral" };
const NOTIFICATION_LABELS: Record<string, string> = { SENT: "Sent", FAILED: "Failed", SUPPRESSED: "Not sent (unticked)", SKIPPED: "Not needed" };

export default async function OrderDetailPage({ params }: Props) {
  const { id } = await params;
  const admin = await requirePermission("sales");
  const finance = can(admin.role, "finance");
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: { orderBy: { position: "asc" } },
      quote: { select: { id: true, number: true } },
      customer: { select: { id: true } },
      invoices: { orderBy: { createdAt: "asc" } },
      payments: { orderBy: { receivedAt: "asc" }, include: { invoice: { select: { number: true } } } },
      internalNotes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      statusEvents: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
      notifications: { orderBy: { createdAt: "desc" }, take: 20 },
      emails: { orderBy: { createdAt: "desc" }, take: 20 },
      files: { orderBy: { createdAt: "asc" }, include: { media: { select: { url: true, originalName: true } } } },
    },
  });
  if (!order) notFound();
  const money = orderMoney(order, order.payments);
  const live = order.invoices.filter((i) => i.status !== "VOIDED" && i.status !== "CANCELED");
  const primary = live.find((i) => i.kind === "FULL") ?? live.find((i) => i.totalCents > i.amountPaidCents && i.status !== "DRAFT") ?? live[0] ?? null;
  const primaryMoney = primary ? invoiceMoney(primary) : null;
  const legacy = live.some((i) => i.kind === "DEPOSIT" || i.kind === "BALANCE");
  const invoicedLive = live.reduce((s, i) => s + i.totalCents, 0);
  const canCreateInvoice = !live.some((i) => i.kind === "FULL") && invoicedLive < order.totalCents;
  const canceled = order.productionStatus === "CANCELED";
  const link = order.customerToken ? customerLinks.order(order.customerToken) : null;
  const invoiceLink = primary?.publicToken ? customerLinks.invoice(primary.publicToken) : null;
  const staffIds = [...new Set(order.notifications.map((n) => n.initiatedById).filter((x): x is string => Boolean(x)))];
  const staff = new Map((await prisma.adminUser.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const canResendStatus = NOTIFY_PRODUCTION_STATUSES.includes(order.productionStatus);

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
                <CopyButton value={link} label="Copy order link" />
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
          <Card title="Production & delivery" description="Production stage is what the customer sees; payment status is tracked separately. Keep shop detail (materials, sanding, finishing, curing…) in the shop notes or internal notes.">
            <ActionForm action={updateOrderAction.bind(null, order.id)} className="space-y-4" successMessage={null}>
              <OrderStatusFields
                current={order.productionStatus}
                canceled={canceled}
                options={PRODUCTION_STATUSES.map((s) => ({ value: s, label: PRODUCTION_STATUS_LABELS[s], help: PRODUCTION_STATUS_HELP[s] }))}
                notifyStatuses={NOTIFY_PRODUCTION_STATUSES}
                delivery={{ date: order.deliveryDate ? siteDateInput(order.deliveryDate) : "", window: order.deliveryWindow ?? "", method: order.deliveryMethod ?? "" }}
                deliveryMethods={DELIVERY_METHODS.map((m) => ({ value: m, label: DELIVERY_METHOD_LABELS[m] }))}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <TextInput label="Estimated completion" name="estimatedCompletion" defaultValue={order.estimatedCompletion ?? ""} maxLength={120} />
                <TextInput label="Delivery address" name="deliveryAddress" defaultValue={order.deliveryAddress ?? ""} maxLength={300} />
              </div>
              <TextArea label="Delivery notes (customer can see)" name="deliveryNotes" rows={2} defaultValue={order.deliveryNotes ?? ""} maxLength={1000} />
              <TextArea label="Notes to the customer (shown on their order page)" name="customerNotes" rows={2} defaultValue={order.customerNotes ?? ""} maxLength={5000} />
              <TextArea label="Shop notes (internal — printed on the work order)" name="productionNotes" rows={4} defaultValue={order.productionNotes ?? ""} maxLength={5000} help="e.g. Materials ordered · Sanding · First coat · Final coat · Curing. Never shown to the customer." />
              <div className="flex justify-end border-t border-neutral-100 pt-4">
                <SubmitButton>Save order</SubmitButton>
              </div>
            </ActionForm>
          </Card>

          <Card
            title="Invoice & payments"
            description={primary ? `One invoice for the whole order — payments (deposit, final balance, cash, check, card) all go on it. ${money.label}.` : "This order has no active invoice."}
            actions={
              finance && !canceled ? (
                <div className="flex flex-wrap gap-2">
                  {primary && primaryMoney && primary.status !== "DRAFT" && !primary.balanceDueAt && primaryMoney.remainingCents > 0 ? (
                    <ConfirmAction
                      action={markBalanceDueAction.bind(null, primary.id)}
                      label="Mark balance due"
                      title={`Request the final balance of ${formatCents(primaryMoney.remainingCents)}?`}
                      body={<p>Invoice {primary.number} stays the same — it becomes “Balance due” and the customer is emailed a link to it, where they can pay the remaining balance. No new invoice is created.</p>}
                      confirmLabel="Mark balance due & email"
                      variant="small"
                      confirmVariant="primary"
                    />
                  ) : null}
                  {primary && primaryMoney && primaryMoney.dueNowCents > 0 ? (
                    <ActionButton action={resendDepositLinkAction.bind(null, primary.id)} variant="small" pendingLabel="Sending…">
                      Email payment link
                    </ActionButton>
                  ) : null}
                  {canCreateInvoice ? (
                    <ConfirmAction
                      action={createOrderInvoiceAction.bind(null, order.id)}
                      label={legacy ? "Create remaining-balance invoice" : "Create order invoice"}
                      title={legacy ? "Create an invoice for the remaining balance?" : "Create this order's invoice?"}
                      body={
                        legacy ? (
                          <p>This order is from before the one-invoice system and already has a separate deposit invoice. This creates one invoice for the rest ({formatCents(order.totalCents - invoicedLive)}); mark its balance due when you&apos;re ready.</p>
                        ) : (
                          <p>Creates the order&apos;s one invoice for the accepted total ({formatCents(order.totalCents)}), with the deposit required.</p>
                        )
                      }
                      confirmLabel="Create invoice"
                      variant="small"
                      confirmVariant="primary"
                      redirectToId="/admin/invoices/"
                    />
                  ) : null}
                </div>
              ) : null
            }
          >
            {primary && primaryMoney ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={`/admin/invoices/${primary.id}`} className="inline-flex min-h-11 items-center font-mono text-sm underline underline-offset-2">
                    {primary.number}
                  </Link>
                  <SalesBadge status={primary.status} />
                  {invoiceLink ? <CopyButton value={invoiceLink} label="Copy invoice link" variant="small" /> : null}
                  <Link href={`/admin/invoices/${primary.id}`} className={adminButton.small}>
                    Open invoice — record or take payments
                  </Link>
                </div>
                <dl className="grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
                  <Stat label="Invoice total" value={formatCents(primaryMoney.totalCents, { showZeroCents: true })} />
                  <Stat label="Deposit required" value={formatCents(primaryMoney.depositCents, { showZeroCents: true })} />
                  <Stat label="Paid" value={formatCents(primaryMoney.paidCents, { showZeroCents: true })} />
                  <Stat label="Pending" value={formatCents(primaryMoney.pendingCents, { showZeroCents: true })} />
                  <Stat label="Remaining" value={formatCents(primaryMoney.remainingCents, { showZeroCents: true })} strong />
                  <Stat label="Due now" value={formatCents(primaryMoney.dueNowCents, { showZeroCents: true })} />
                </dl>
                {primary.balanceDueAt ? <p className="text-xs text-neutral-600">Final balance requested {formatDate(primary.balanceDueAt, true)}.</p> : null}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">{canceled ? "Canceled order." : "Create the order's invoice to take payments."}</p>
            )}
            {order.invoices.length > 1 || legacy ? (
              <div className="mt-5 border-t border-neutral-100 pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">All invoices on this order</p>
                <ul className="space-y-1.5 text-sm">
                  {order.invoices.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/invoices/${i.id}`} className="inline-flex min-h-11 items-center font-mono underline underline-offset-2">
                        {i.number}
                      </Link>
                      <span className="text-neutral-600">{INVOICE_KIND_LABELS[i.kind]}</span>
                      <SalesBadge status={i.status} />
                      <Money cents={i.totalCents} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {order.payments.length ? (
              <div className="mt-5 border-t border-neutral-100 pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Payments</p>
                <ul className="space-y-1.5 text-sm">
                  {order.payments.map((p) => (
                    <li key={p.id} className={cn("flex flex-wrap items-center justify-between gap-2", ["VOIDED", "FAILED", "RETURNED"].includes(p.status) && "text-neutral-400")}>
                      <span>
                        {formatDate(p.receivedAt)} · {PAYMENT_METHOD_LABELS[p.method]} — {PAYMENT_TYPE_LABELS[p.type]}
                        {p.method === "CHECK" && p.reference ? ` · #${p.reference}` : ""}
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge tone={p.status === "SUCCEEDED" ? "green" : p.status === "PENDING" ? "amber" : "neutral"}>{paymentStatusLabel(p.method, p.status)}</Badge>
                        <Money cents={p.amountCents} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          <Card title="Items" description="Copied from the accepted quote — later catalog or quote edits never change them.">
            <RevisionLines
              lines={order.items.map((i) => ({ id: i.id, kind: i.kind, description: i.description ?? i.productName, notes: i.notes, quantity: i.quantity, unitPriceCents: i.unitPriceCents, lineTotalCents: i.lineTotalCents }))}
              totals={{ subtotalCents: order.subtotalCents, discountCents: order.discountCents, deliveryCents: order.shippingCents, otherChargesCents: 0, taxCents: order.taxCents, totalCents: order.totalCents, depositCents: order.depositCents, balanceCents: order.totalCents - order.depositCents }}
            />
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
          <Card
            title="Status emails"
            description="Customers are emailed when the production stage changes (unless unticked). Failures are kept here so you can resend."
            actions={
              canResendStatus ? (
                <ActionButton action={resendStatusEmailAction.bind(null, order.id)} variant="small" pendingLabel="Sending…">
                  Resend status email
                </ActionButton>
              ) : null
            }
          >
            {order.notifications.length ? (
              <ul className="space-y-2 text-sm">
                {order.notifications.map((n) => (
                  <li key={n.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={NOTIFICATION_TONES[n.status] ?? "neutral"}>{NOTIFICATION_LABELS[n.status] ?? n.status}</Badge>
                      <span>
                        {n.fromStatus && n.fromStatus !== n.toStatus ? `${statusLabel(n.fromStatus)} → ` : ""}
                        {statusLabel(n.toStatus)}
                        {n.fromStatus === n.toStatus ? " (resent)" : ""}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500">
                      {formatDate(n.createdAt, true)} · {n.email}
                      {n.initiatedById ? ` · ${staff.get(n.initiatedById) ?? "staff"}` : " · automatic"}
                      {n.error ? ` · ${n.error}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">No status emails yet.</p>
            )}
          </Card>
          <Card title="Money">
            <DescriptionList
              className="sm:grid-cols-[7rem_1fr]"
              items={[
                { label: "Order total", value: <Money cents={order.totalCents} /> },
                { label: "Deposit", value: <Money cents={order.depositCents} /> },
                { label: "Paid", value: <Money cents={money.paidCents} /> },
                { label: "Pending", value: money.pendingCents ? <Money cents={money.pendingCents} /> : null },
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

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className={cn("mt-0.5 tabular-nums", strong ? "font-semibold text-neutral-900" : "text-neutral-900")}>{value}</dd>
    </div>
  );
}
