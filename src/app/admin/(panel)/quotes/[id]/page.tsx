import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuoteStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { formatCents } from "@/lib/money";
import { parseSnapshot } from "@/lib/pricing/snapshot";
import { Badge, Card, DescriptionList, PageHeader, StatusBadge, adminButton, formatDate } from "@/components/admin/ui";
import { AttachmentsGrid } from "@/components/admin/inbox/AttachmentsGrid";
import { NotesPanel } from "@/components/admin/inbox/NotesPanel";
import { SnapshotView } from "@/components/admin/inbox/SnapshotView";
import { StatusControl } from "@/components/admin/inbox/StatusControl";
import { StatusHistory } from "@/components/admin/inbox/StatusHistory";
import { CustomerCard, LongText } from "@/components/admin/inbox/CustomerCard";
import { statusLabel } from "@/components/admin/inbox/kinds";
import { addNoteAction, changeStatusAction } from "../../inbox-actions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const q = await prisma.quoteRequest.findUnique({ where: { id }, select: { reference: true } });
  return { title: q ? `Quote ${q.reference}` : "Quote not found" };
}

export default async function QuoteDetailPage({ params }: Props) {
  const { id } = await params;
  const admin = await requireAdmin();

  // Mark as read on first open (atomic: only when still unread).
  await prisma.quoteRequest.updateMany({ where: { id, readAt: null }, data: { readAt: new Date() } });

  const quote = await prisma.quoteRequest.findUnique({
    where: { id },
    include: {
      product: { select: { id: true } },
      attachments: { orderBy: { createdAt: "asc" }, select: { id: true, filename: true, size: true, width: true, height: true } },
      internalNotes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      statusEvents: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
    },
  });
  if (!quote) notFound();

  const snapshot = parseSnapshot(quote.configuration);
  const mailto = `mailto:${quote.email}?subject=${encodeURIComponent(`Your Wild Mountain quote ${quote.reference}`)}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Quotes", href: "/admin/quotes" }, { label: quote.reference }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{quote.reference}</span>
            <StatusBadge status={quote.status} />
          </span>
        }
        description={`${quote.source === "GENERAL" ? "General quote request" : "Configurator quote request"} · received ${formatDate(quote.createdAt, true)}`}
        actions={
          <a href={mailto} className={adminButton.primary}>
            Reply by email
          </a>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card title="Requested configuration">
            {snapshot ? (
              <SnapshotView snapshot={snapshot} currentProductId={quote.product?.id ?? null} />
            ) : (
              <div className="space-y-2 text-sm">
                <p className="text-neutral-700">
                  {quote.source === "GENERAL"
                    ? "General request — the customer did not use the product configurator."
                    : "No configuration snapshot was stored with this request."}
                </p>
                {quote.productName ? (
                  <p>
                    Product mentioned: <span className="font-medium">{quote.productName}</span>
                  </p>
                ) : null}
                {quote.estimatedTotalCents != null ? <p>Estimate: {formatCents(quote.estimatedTotalCents)}</p> : null}
              </div>
            )}
          </Card>

          <Card title="Request details">
            <DescriptionList
              items={[
                { label: "Requested dimensions", value: quote.requestedDimensions ? <LongText text={quote.requestedDimensions} /> : null },
                { label: "Desired timeline", value: quote.timeline },
                { label: "Notes from customer", value: quote.notes ? <LongText text={quote.notes} /> : null },
              ]}
            />
          </Card>

          <Card title="Reference images" description={quote.attachments.length ? `${quote.attachments.length} image(s) uploaded by the customer.` : undefined}>
            <AttachmentsGrid attachments={quote.attachments} />
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <CustomerCard name={quote.name} email={quote.email} phone={quote.phone} zipCode={quote.zipCode} mailto={mailto} />

          <Card title="Status">
            <StatusControl
              action={changeStatusAction.bind(null, "quote", quote.id)}
              current={quote.status}
              options={Object.values(QuoteStatus).map((s) => ({ value: s, label: statusLabel(s) }))}
            />
            <h3 className="mb-3 mt-6 text-sm font-semibold text-neutral-900">History</h3>
            <StatusHistory events={quote.statusEvents} />
            {quote.readAt ? (
              <p className="mt-4 text-xs text-neutral-500">
                <Badge tone="neutral">Read</Badge> first opened {formatDate(quote.readAt, true)}
              </p>
            ) : null}
          </Card>

          <NotesPanel notes={quote.internalNotes} currentAdminId={admin.id} addAction={addNoteAction.bind(null, "quote", quote.id)} />
        </div>
      </div>
    </>
  );
}
