import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { ActionButton } from "@/components/admin/forms";
import { Card, PageHeader, StatusBadge, adminButton, formatDate } from "@/components/admin/ui";
import { CustomerCard, LongText } from "@/components/admin/inbox/CustomerCard";
import { ActionThenNavigate } from "@/components/admin/inbox/ActionThenNavigate";
import { NotesPanel } from "@/components/admin/inbox/NotesPanel";
import { RefreshOnMount } from "@/components/admin/inbox/RefreshOnMount";
import { StatusHistory } from "@/components/admin/inbox/StatusHistory";
import { contactReasonLabel } from "@/components/admin/inbox/kinds";
import { addNoteAction, setStatusAction } from "../../inbox-actions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const m = await prisma.contactMessage.findUnique({ where: { id }, select: { name: true } });
  return { title: m ? `Message from ${m.name}` : "Message not found" };
}

export default async function MessageDetailPage({ params }: Props) {
  const { id } = await params;
  const admin = await requireAdmin();

  // Opening an unread message marks it read (atomic, recorded in history).
  // Skipped when this render is the refresh that follows a server action —
  // otherwise "Mark unread" would be immediately undone.
  const isActionRender = (await headers()).has("next-action");
  const marked = isActionRender
    ? { count: 0 }
    : await prisma.contactMessage.updateMany({ where: { id, status: "UNREAD" }, data: { status: "READ", readAt: new Date() } });
  if (marked.count > 0) {
    await prisma.statusEvent.create({ data: { fromStatus: "UNREAD", toStatus: "READ", authorId: admin.id, contactMessageId: id } });
  }

  const msg = await prisma.contactMessage.findUnique({
    where: { id },
    include: {
      internalNotes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      statusEvents: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
    },
  });
  if (!msg) notFound();

  const reason = contactReasonLabel(msg.reason);
  const mailto = `mailto:${msg.email}?subject=${encodeURIComponent(`Re: your message to Wild Mountain Woodworks (${reason.toLowerCase()})`)}`;
  const set = (status: string) => setStatusAction.bind(null, "message", msg.id, status);

  return (
    <>
      {marked.count > 0 ? <RefreshOnMount /> : null}
      <PageHeader
        breadcrumbs={[{ label: "Messages", href: "/admin/messages" }, { label: msg.name }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>Message from {msg.name}</span>
            <StatusBadge status={msg.status} />
          </span>
        }
        description={`${reason} · received ${formatDate(msg.createdAt, true)}`}
        actions={
          <>
            <a href={mailto} className={adminButton.primary}>
              Reply by email
            </a>
            {msg.status !== "REPLIED" && msg.status !== "ARCHIVED" ? (
              <ActionButton action={set("REPLIED")} pendingLabel="Saving…" successMessage="Marked as replied.">
                Mark replied
              </ActionButton>
            ) : null}
            {msg.status !== "UNREAD" && msg.status !== "ARCHIVED" ? (
              <ActionThenNavigate action={set("UNREAD")} href="/admin/messages">
                Mark unread
              </ActionThenNavigate>
            ) : null}
            {msg.status === "ARCHIVED" ? (
              <ActionButton action={set("READ")} pendingLabel="Restoring…" successMessage="Moved back to the inbox.">
                Unarchive
              </ActionButton>
            ) : (
              <ActionButton action={set("ARCHIVED")} pendingLabel="Archiving…" successMessage="Message archived.">
                Archive
              </ActionButton>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card title="Message" description={`Reason: ${reason}`}>
            <div className="text-[0.95rem] leading-relaxed text-neutral-900">
              <LongText text={msg.message} />
            </div>
          </Card>
          <NotesPanel notes={msg.internalNotes} currentAdminId={admin.id} addAction={addNoteAction.bind(null, "message", msg.id)} />
        </div>

        <div className="min-w-0 space-y-6">
          <CustomerCard title="Contact" name={msg.name} email={msg.email} phone={msg.phone} mailto={mailto} />
          <Card title="Status history">
            <StatusHistory events={msg.statusEvents} originLabel="Sent by customer" />
          </Card>
        </div>
      </div>
    </>
  );
}
