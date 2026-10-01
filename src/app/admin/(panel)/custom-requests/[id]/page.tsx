import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomRequestStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { Card, DescriptionList, PageHeader, StatusBadge, adminButton, formatDate } from "@/components/admin/ui";
import { AttachmentsGrid } from "@/components/admin/inbox/AttachmentsGrid";
import { CustomerCard, LongText } from "@/components/admin/inbox/CustomerCard";
import { NotesPanel } from "@/components/admin/inbox/NotesPanel";
import { StatusControl } from "@/components/admin/inbox/StatusControl";
import { StatusHistory } from "@/components/admin/inbox/StatusHistory";
import { statusLabel } from "@/components/admin/inbox/kinds";
import { addNoteAction, changeStatusAction } from "../../inbox-actions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const r = await prisma.customRequest.findUnique({ where: { id }, select: { reference: true } });
  return { title: r ? `Custom request ${r.reference}` : "Custom request not found" };
}

export default async function CustomRequestDetailPage({ params }: Props) {
  const { id } = await params;
  const admin = await requireAdmin();

  await prisma.customRequest.updateMany({ where: { id, readAt: null }, data: { readAt: new Date() } });

  const req = await prisma.customRequest.findUnique({
    where: { id },
    include: {
      attachments: { orderBy: { createdAt: "asc" }, select: { id: true, filename: true, size: true, width: true, height: true } },
      internalNotes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      statusEvents: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
    },
  });
  if (!req) notFound();

  const mailto = `mailto:${req.email}?subject=${encodeURIComponent(`Your Wild Mountain Woodworks custom furniture request ${req.reference}`)}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Custom Requests", href: "/admin/custom-requests" }, { label: req.reference }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{req.reference}</span>
            <StatusBadge status={req.status} />
          </span>
        }
        description={`${req.furnitureType} · received ${formatDate(req.createdAt, true)}`}
        actions={
          <a href={mailto} className={adminButton.primary}>
            Reply by email
          </a>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card title="The piece">
            <DescriptionList
              items={[
                { label: "Furniture type", value: req.furnitureType },
                { label: "Approximate dimensions", value: req.approximateDimensions ? <LongText text={req.approximateDimensions} /> : null },
                { label: "Wood preference", value: req.woodPreference },
                { label: "Finish preference", value: req.finishPreference },
                { label: "Desired timeline", value: req.timeline },
              ]}
            />
          </Card>

          <Card title="Description">
            <LongText text={req.description} />
          </Card>

          <Card title="Reference images" description={req.attachments.length ? `${req.attachments.length} image(s) uploaded by the customer.` : undefined}>
            <AttachmentsGrid attachments={req.attachments} />
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <CustomerCard name={req.name} email={req.email} phone={req.phone} zipCode={req.zipCode} mailto={mailto} />

          <Card title="Status">
            <StatusControl
              action={changeStatusAction.bind(null, "custom_request", req.id)}
              current={req.status}
              options={Object.values(CustomRequestStatus).map((s) => ({ value: s, label: statusLabel(s) }))}
            />
            <h3 className="mb-3 mt-6 text-sm font-semibold text-neutral-900">History</h3>
            <StatusHistory events={req.statusEvents} />
          </Card>

          <NotesPanel notes={req.internalNotes} currentAdminId={admin.id} addAction={addNoteAction.bind(null, "custom_request", req.id)} />
        </div>
      </div>
    </>
  );
}
