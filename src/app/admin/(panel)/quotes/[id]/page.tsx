import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { parseSnapshot } from "@/lib/pricing/snapshot";
import { centsToDollarInput } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { siteDateInput } from "@/lib/site-time";
import { customerLinks } from "@/lib/sales/links";
import { MANUAL_QUOTE_STATUSES, customerRevisionOf, ensureQuoteReady, expireDueQuotes, type AcceptedSnapshot } from "@/lib/sales/quotes";
import { QUOTE_STATUS_LABELS, REVISION_STATUS_LABELS } from "@/lib/sales/status";
import { formatBps, type LineKind } from "@/lib/sales/totals";
import { ActionButton, ConfirmAction, Select, TextArea, TextInput, Toggle } from "@/components/admin/forms";
import { Badge, Card, DescriptionList, PageHeader, adminButton, formatDate, table } from "@/components/admin/ui";
import { AttachmentsGrid } from "@/components/admin/inbox/AttachmentsGrid";
import { NotesPanel } from "@/components/admin/inbox/NotesPanel";
import { SnapshotView } from "@/components/admin/inbox/SnapshotView";
import { StatusHistory } from "@/components/admin/inbox/StatusHistory";
import { LongText } from "@/components/admin/inbox/CustomerCard";
import { ImageField } from "@/components/admin/media/ImageField";
import { CopyButton } from "@/components/admin/sales/CopyButton";
import { EmailLogCard } from "@/components/admin/sales/EmailLogCard";
import { FormDialog } from "@/components/admin/sales/FormDialog";
import { Money } from "@/components/admin/sales/Money";
import { QuoteEditor } from "@/components/admin/sales/QuoteEditor";
import { RevisionLines } from "@/components/admin/sales/RevisionLines";
import { SalesBadge } from "@/components/admin/sales/SalesBadge";
import { cn } from "@/lib/cn";
import { addNoteAction } from "../../inbox-actions";
import {
  acceptQuoteManuallyAction,
  addSalesAttachmentAction,
  archiveQuoteAction,
  createRevisionAction,
  duplicateQuoteAction,
  extendQuoteAction,
  removeSalesAttachmentAction,
  resendQuoteAction,
  saveQuoteRevisionAction,
  sendQuoteAction,
  setQuoteStatusAction,
  setSalesAttachmentVisibilityAction,
} from "../../sales-actions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const q = await prisma.quoteRequest.findUnique({ where: { id }, select: { number: true, reference: true } });
  return { title: q ? `Quote ${q.number ?? q.reference}` : "Quote not found" };
}

const lastDay = (d: Date) => new Date(d.getTime() - 1);

export default async function QuoteDetailPage({ params }: Props) {
  const { id } = await params;
  const admin = await requirePermission("sales");
  const canPrice = can(admin.role, "finance");
  if (!(await ensureQuoteReady(id))) notFound();
  await expireDueQuotes();
  await prisma.quoteRequest.updateMany({ where: { id, readAt: null }, data: { readAt: new Date() } });

  const [quote, settings, products] = await Promise.all([
    prisma.quoteRequest.findUnique({
      where: { id },
      include: {
        product: { select: { id: true } },
        customer: { select: { id: true, name: true, email: true, phone: true } },
        attachments: { orderBy: { createdAt: "asc" }, select: { id: true, filename: true, size: true, width: true, height: true } },
        files: { orderBy: { createdAt: "asc" }, include: { media: { select: { id: true, url: true, originalName: true, width: true, height: true, alt: true, focalX: true, focalY: true } } } },
        internalNotes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
        statusEvents: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
        revisions: { orderBy: { number: "desc" }, include: { lineItems: { orderBy: { position: "asc" } } } },
        orders: { select: { id: true, number: true, productionStatus: true, paymentStatus: true } },
        invoices: { orderBy: { createdAt: "asc" }, select: { id: true, number: true, kind: true, status: true, totalCents: true } },
        emails: { orderBy: { createdAt: "desc" }, take: 20 },
        priceEstimates: { select: { id: true, name: true, finalPriceCents: true } },
      },
    }),
    getSettings(),
    prisma.product.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, basePriceCents: true } }),
  ]);
  if (!quote) notFound();

  const current = quote.revisions.find((r) => r.id === quote.currentRevisionId) ?? quote.revisions[0]!;
  const customerRev = customerRevisionOf(quote.revisions);
  const snapshot = parseSnapshot(quote.configuration);
  const link = quote.customerToken ? customerLinks.quote(quote.customerToken) : null;
  const closed = ["ACCEPTED", "CONVERTED_TO_INVOICE", "COMPLETED", "CANCELED"].includes(quote.status);
  const editable = current.status === "DRAFT" && !closed && canPrice;
  const accepted = quote.revisions.find((r) => r.status === "ACCEPTED");
  const acceptedSnap = accepted?.acceptedSnapshot as AcceptedSnapshot | null | undefined;
  const order = quote.orders[0];
  const title = quote.number ?? quote.reference;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Quotes", href: "/admin/quotes" }, { label: title }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{title}</span>
            <SalesBadge status={quote.status} />
            {quote.archivedAt ? <Badge tone="amber">Archived</Badge> : null}
          </span>
        }
        description={`${{ CONFIGURATOR: "Configurator request", GENERAL: "General request", MANUAL: "Created by staff", ESTIMATE: "From a price estimate" }[quote.source]} · received ${formatDate(quote.createdAt, true)} · revision ${current.number} (${REVISION_STATUS_LABELS[current.status].toLowerCase()})`}
        actions={
          <>
            {editable ? (
              <ConfirmAction
                action={sendQuoteAction.bind(null, quote.id)}
                label={customerRev ? `Send revision ${current.number}` : "Send quote"}
                title={customerRev ? `Send revision ${current.number}?` : "Send this quote?"}
                body={
                  <>
                    <p>
                      The customer is emailed a secure link to view and accept it. Once sent, this revision can&apos;t be edited{customerRev ? `, and revision ${customerRev.number} can no longer be accepted` : ""}.
                    </p>
                    <p className="mt-2">Make sure you saved your latest changes.</p>
                  </>
                }
                confirmLabel="Send quote"
                variant="primary"
                confirmVariant="primary"
              />
            ) : null}
            {!editable && !closed && canPrice && current.status !== "DRAFT" ? (
              <ActionButton action={createRevisionAction.bind(null, quote.id)} variant="secondary">
                Create revision
              </ActionButton>
            ) : null}
            {link && customerRev ? (
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
          {quote.status === "NEW" || quote.status === "REVIEWING" ? (
            <p className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              New request. Review the prefilled lines below (from what the customer configured, at today&apos;s prices), adjust anything, save, then send.
            </p>
          ) : null}

          {accepted && acceptedSnap ? (
            <Card title={`Accepted — revision ${accepted.number}`} description="Frozen record of exactly what the customer accepted.">
              <DescriptionList
                items={[
                  { label: "Accepted by", value: `${accepted.acceptedName}${accepted.acceptedManuallyById ? " (recorded by staff)" : " (online)"}` },
                  { label: "When", value: formatDate(accepted.acceptedAt, true) },
                  { label: "IP address", value: accepted.acceptedIp },
                  { label: "Browser", value: accepted.acceptedUserAgent ? <span className="text-xs">{accepted.acceptedUserAgent}</span> : null },
                  { label: "Confirmed", value: <LongText text={acceptedSnap.agreements.map((a) => `✓ ${a}`).join("\n")} /> },
                  { label: "Deposit", value: acceptedSnap.deposit.label },
                ]}
              />
              <div className="mt-5">
                <RevisionLines lines={acceptedSnap.lines} totals={acceptedSnap.totals} />
              </div>
            </Card>
          ) : null}

          {editable ? (
            <QuoteEditor
              action={saveQuoteRevisionAction.bind(null, quote.id)}
              taxEnabled={settings.taxEnabled}
              products={products}
              initial={{
                customerName: current.customerName,
                customerEmail: current.customerEmail,
                customerPhone: current.customerPhone ?? "",
                customerAddress: current.customerAddress ?? "",
                customerNotes: current.customerNotes ?? "",
                terms: current.terms ?? "",
                expiresOn: current.expiresAt ? siteDateInput(lastDay(current.expiresAt)) : "",
                leadTime: current.leadTime ?? "",
                estimatedCompletion: current.estimatedCompletion ?? "",
                deliveryDetails: current.deliveryDetails ?? "",
                depositType: current.depositType,
                depositPercent: current.depositPercentBps != null ? formatBps(current.depositPercentBps).replace("%", "") : "50",
                depositAmount: centsToDollarInput(current.depositAmountCents),
                tax: centsToDollarInput(current.taxCents || null),
                lines: current.lineItems.map((l) => ({
                  key: l.id,
                  sourceId: l.id,
                  kind: l.kind as LineKind,
                  description: l.description,
                  notes: l.notes ?? "",
                  quantity: String(l.quantity),
                  price: centsToDollarInput(Math.abs(l.unitPriceCents)),
                  taxable: l.taxable,
                  productId: l.productId,
                })),
              }}
            />
          ) : !accepted ? (
            <Card
              title={`Revision ${current.number}`}
              description={current.status === "DRAFT" ? "Draft — only admins with finance access can edit pricing." : `${REVISION_STATUS_LABELS[current.status]}${current.sentAt ? ` ${formatDate(current.sentAt, true)}` : ""}. Sent revisions can't be edited — create a new revision to make changes.`}
            >
              <RevisionLines lines={current.lineItems} totals={current} />
              <DescriptionList
                className="mt-6"
                items={[
                  { label: "Deposit", value: current.depositType === "PERCENTAGE" && current.depositPercentBps != null ? `${formatBps(current.depositPercentBps)}` : current.depositType === "FIXED_AMOUNT" ? "Fixed amount" : "None" },
                  { label: "Valid through", value: current.expiresAt ? formatDate(lastDay(current.expiresAt)) : null },
                  { label: "Lead time", value: current.leadTime },
                  { label: "Estimated completion", value: current.estimatedCompletion },
                  { label: "Delivery", value: current.deliveryDetails },
                  { label: "Customer notes", value: current.customerNotes ? <LongText text={current.customerNotes} /> : null },
                  { label: "Terms", value: current.terms ? <LongText text={current.terms} /> : null },
                ]}
              />
            </Card>
          ) : null}

          <Card title="Original request" description="What the customer asked for, exactly as submitted (prices as of the request).">
            {snapshot ? (
              <SnapshotView snapshot={snapshot} currentProductId={quote.product?.id ?? null} />
            ) : (
              <p className="text-sm text-neutral-700">{quote.productName ? <>Interested in: <span className="font-medium">{quote.productName}</span></> : "No configuration was submitted."}</p>
            )}
            <DescriptionList
              className="mt-5"
              items={[
                { label: "Quantity", value: quote.quantity > 1 ? String(quote.quantity) : null },
                { label: "Delivery address", value: quote.address },
                { label: "Dimensions", value: quote.requestedDimensions ? <LongText text={quote.requestedDimensions} /> : null },
                { label: "Timeline", value: quote.timeline },
                { label: "Customer notes", value: quote.notes ? <LongText text={quote.notes} /> : null },
              ]}
            />
            {quote.attachments.length ? (
              <div className="mt-5">
                <h3 className="mb-2 text-sm font-semibold">Reference images from the customer</h3>
                <AttachmentsGrid attachments={quote.attachments} />
              </div>
            ) : null}
          </Card>

          <Card
            title="Drawings & photos"
            description="Attach images from the media library. Internal unless marked visible to the customer."
            actions={
              <FormDialog label="Attach" title="Attach a file" action={addSalesAttachmentAction.bind(null, "quote", quote.id)} submitLabel="Attach" variant="small">
                <ImageField name="mediaId" label="Image" value={null} slot="square" compact />
                <TextInput label="Label" name="label" maxLength={120} placeholder="e.g. Top view drawing" />
                <Toggle label="Visible to the customer" name="customerVisible" description="Shown on their quote page." />
              </FormDialog>
            }
          >
            {quote.files.length ? (
              <ul className="divide-y divide-neutral-100">
                {quote.files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <a href={f.media.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                      {f.label || f.media.originalName}
                    </a>
                    <span className="flex items-center gap-2">
                      <Badge tone={f.customerVisible ? "green" : "neutral"}>{f.customerVisible ? "Customer can see" : "Internal"}</Badge>
                      <ActionButton action={setSalesAttachmentVisibilityAction.bind(null, f.id, !f.customerVisible)} variant="small">
                        {f.customerVisible ? "Hide" : "Show to customer"}
                      </ActionButton>
                      <ConfirmAction action={removeSalesAttachmentAction.bind(null, f.id)} label="Remove" title="Remove this file from the quote?" body="The image stays in the media library." variant="small" confirmLabel="Remove" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">No files attached.</p>
            )}
          </Card>

          <Card title="Revisions" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className={table.table}>
                <thead className={table.thead}>
                  <tr>
                    <th scope="col" className={table.th}>Rev</th>
                    <th scope="col" className={table.th}>Status</th>
                    <th scope="col" className={cn(table.th, "text-right")}>Total</th>
                    <th scope="col" className={table.th}>Sent</th>
                    <th scope="col" className={table.th}>Viewed</th>
                    <th scope="col" className={table.th}>Response</th>
                  </tr>
                </thead>
                <tbody className={table.tbody}>
                  {quote.revisions.map((r) => (
                    <tr key={r.id}>
                      <td className={table.td}>{r.number}</td>
                      <td className={table.td}>
                        <SalesBadge status={r.status} />
                      </td>
                      <td className={cn(table.td, "text-right")}>
                        <Money cents={r.totalCents} />
                      </td>
                      <td className={cn(table.td, "whitespace-nowrap")}>{formatDate(r.sentAt, true)}</td>
                      <td className={cn(table.td, "whitespace-nowrap")}>{formatDate(r.viewedAt, true)}</td>
                      <td className={table.td}>
                        {r.acceptedAt ? `Accepted ${formatDate(r.acceptedAt)}` : r.declinedAt ? `Declined ${formatDate(r.declinedAt)}${r.declineReason ? `: ${r.declineReason}` : ""}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card
            title="Customer"
            actions={
              quote.customer ? (
                <Link href={`/admin/customers/${quote.customer.id}`} className={adminButton.small}>
                  Customer page
                </Link>
              ) : null
            }
          >
            <DescriptionList
              className="sm:grid-cols-[5rem_1fr]"
              items={[
                { label: "Name", value: current.customerName },
                { label: "Email", value: <a href={`mailto:${current.customerEmail}`} className="underline underline-offset-2">{current.customerEmail}</a> },
                { label: "Phone", value: current.customerPhone ? <a href={`tel:${current.customerPhone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-2">{current.customerPhone}</a> : null },
                { label: "ZIP", value: quote.zipCode || null },
              ]}
            />
          </Card>

          <Card title="Workflow">
            <div className="flex flex-col gap-2">
              {customerRev && !closed ? (
                <ActionButton action={resendQuoteAction.bind(null, quote.id)} pendingLabel="Sending…">
                  Resend quote email
                </ActionButton>
              ) : null}
              {customerRev?.status === "SENT" && !closed ? (
                <FormDialog label="Record acceptance" title="Record the customer's acceptance" description={`For acceptance by phone, email or in person. Accepts revision ${customerRev.number} and creates the order.`} action={acceptQuoteManuallyAction.bind(null, quote.id)} submitLabel="Record acceptance" redirectToId="/admin/orders/">
                  <TextArea label="How did they accept?" name="note" rows={3} required maxLength={500} placeholder="e.g. Accepted by phone on Oct 2 — confirmed walnut and 84in." />
                </FormDialog>
              ) : null}
              {customerRev?.status === "SENT" && !closed ? (
                <FormDialog label="Extend expiration" title="Extend this quote" description="Gives the customer more time. An expired quote becomes acceptable again." action={extendQuoteAction.bind(null, quote.id)} submitLabel="Extend">
                  <TextInput label="Valid through" name="expiresOn" type="date" required />
                </FormDialog>
              ) : null}
              <FormDialog label="Change status" title="Change quote status" description="Sent, viewed, accepted and invoiced are set automatically by the workflow." action={setQuoteStatusAction.bind(null, quote.id)} submitLabel="Update status">
                <Select label="Status" name="status" defaultValue={MANUAL_QUOTE_STATUSES.includes(quote.status) ? quote.status : "REVIEWING"} options={MANUAL_QUOTE_STATUSES.map((s) => ({ value: s, label: QUOTE_STATUS_LABELS[s] }))} />
                <TextArea label="Internal note (optional)" name="note" rows={2} maxLength={1000} />
              </FormDialog>
              {canPrice ? (
                <ConfirmAction action={duplicateQuoteAction.bind(null, quote.id)} label="Duplicate quote" title="Duplicate this quote?" body="Creates a new draft quote with a new number and link, copying the lines, terms and customer. Acceptance, invoices and payments are never copied." confirmLabel="Duplicate" confirmVariant="primary" redirectToId="/admin/quotes/" />
              ) : null}
              <Link href={`/admin/pricing-calculator?quote=${quote.id}`} className={adminButton.secondary}>
                Price in calculator
              </Link>
              <ConfirmAction
                action={archiveQuoteAction.bind(null, quote.id, !quote.archivedAt)}
                label={quote.archivedAt ? "Restore from archive" : "Archive"}
                title={quote.archivedAt ? "Restore this quote?" : "Archive this quote?"}
                body={quote.archivedAt ? "It returns to the quote lists." : "It's hidden from the quote lists and its customer link stops working. Nothing is deleted."}
                confirmLabel={quote.archivedAt ? "Restore" : "Archive"}
                variant="ghost"
              />
            </div>
          </Card>

          {order || quote.invoices.length ? (
            <Card title="Order & invoices">
              <ul className="space-y-2 text-sm">
                {order ? (
                  <li className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/admin/orders/${order.id}`} className="font-mono underline underline-offset-2">
                      {order.number}
                    </Link>
                    <span className="flex gap-1">
                      <SalesBadge status={order.productionStatus} />
                      <SalesBadge status={order.paymentStatus} />
                    </span>
                  </li>
                ) : null}
                {quote.invoices.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/admin/invoices/${i.id}`} className="font-mono underline underline-offset-2">
                      {i.number}
                    </Link>
                    <span className="flex items-center gap-2">
                      <Money cents={i.totalCents} />
                      <SalesBadge status={i.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {quote.priceEstimates.length ? (
            <Card title="Price estimates" description="Internal cost backup — never shown to customers.">
              <ul className="space-y-1 text-sm">
                {quote.priceEstimates.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <Link href={`/admin/pricing-calculator?estimate=${e.id}`} className="underline underline-offset-2">
                      {e.name}
                    </Link>
                    <Money cents={e.finalPriceCents} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card title="History">
            <StatusHistory events={quote.statusEvents} />
          </Card>

          <NotesPanel notes={quote.internalNotes} currentAdminId={admin.id} addAction={addNoteAction.bind(null, "quote", quote.id)} />
          <EmailLogCard emails={quote.emails} />
        </div>
      </div>
    </>
  );
}
