"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { CustomRequestStatus, MessageStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { adminAction, AdminError, fd } from "@/lib/admin/action";
import { INBOX_KIND_META, INBOX_KINDS, statusLabel, type InboxKind } from "@/components/admin/inbox/kinds";

/*
 * Generic inbox actions: internal notes (quotes, custom requests, messages,
 * orders, invoices, customers) and status changes for custom requests and
 * messages (each recorded as a StatusEvent). Quote and order statuses follow
 * the sales workflow and are changed by their own actions.
 *
 * Internal notes are never shown to customers.
 */

const noteSchema = z.object({
  body: z.string().trim().min(1, "Write a note before saving.").max(5000, "Keep notes under 5,000 characters."),
});

const idSchema = z.string().min(1).max(64);

function assertKind(kind: unknown): InboxKind {
  if (typeof kind !== "string" || !INBOX_KINDS.includes(kind as InboxKind)) throw new AdminError("Unknown record type.");
  return kind as InboxKind;
}

/** FK column on InternalNote / StatusEvent for each kind. */
const FK: Record<InboxKind, "quoteRequestId" | "customRequestId" | "contactMessageId" | "orderId" | "invoiceId" | "customerId"> = {
  quote: "quoteRequestId",
  custom_request: "customRequestId",
  message: "contactMessageId",
  order: "orderId",
  invoice: "invoiceId",
  customer: "customerId",
};

type TargetInfo = { label: string; status: string; readAt?: Date | null };

/** Load the target record (throws a friendly error if it no longer exists). */
async function loadTarget(kind: InboxKind, id: string): Promise<TargetInfo> {
  switch (kind) {
    case "quote": {
      const r = await prisma.quoteRequest.findUnique({ where: { id }, select: { reference: true, number: true, status: true, readAt: true } });
      if (r) return { label: `Quote ${r.number ?? r.reference}`, status: r.status, readAt: r.readAt };
      break;
    }
    case "custom_request": {
      const r = await prisma.customRequest.findUnique({ where: { id }, select: { reference: true, status: true, readAt: true } });
      if (r) return { label: `Custom request ${r.reference}`, status: r.status, readAt: r.readAt };
      break;
    }
    case "message": {
      const r = await prisma.contactMessage.findUnique({ where: { id }, select: { name: true, status: true, readAt: true } });
      if (r) return { label: `Message from ${r.name}`, status: r.status, readAt: r.readAt };
      break;
    }
    case "order": {
      const r = await prisma.order.findUnique({ where: { id }, select: { number: true, productionStatus: true } });
      if (r) return { label: `Order ${r.number}`, status: r.productionStatus };
      break;
    }
    case "invoice": {
      const r = await prisma.invoice.findUnique({ where: { id }, select: { number: true, status: true } });
      if (r) return { label: `Invoice ${r.number}`, status: r.status };
      break;
    }
    case "customer": {
      const r = await prisma.customer.findUnique({ where: { id }, select: { name: true } });
      if (r) return { label: `Customer ${r.name}`, status: "" };
      break;
    }
  }
  throw new AdminError("That record no longer exists.");
}

function revalidateInbox(kind: InboxKind, id: string) {
  const base = INBOX_KIND_META[kind].basePath;
  revalidatePath(base);
  revalidatePath(`${base}/${id}`);
  // Dashboard tiles and sidebar unread counts.
  revalidatePath("/admin", "layout");
}

/* -------------------------------------------------------------------------- */
/* Notes                                                                       */
/* -------------------------------------------------------------------------- */

export const addNoteAction = adminAction(async (admin, kindArg: InboxKind, idArg: string, formData: FormData) => {
  const kind = assertKind(kindArg);
  const id = idSchema.parse(idArg);
  const { body } = noteSchema.parse({ body: fd.str(formData, "body") });
  const target = await loadTarget(kind, id);
  await prisma.internalNote.create({ data: { body, authorId: admin.id, [FK[kind]]: id } });
  await logActivity("note.added", `${admin.name} added a note to ${target.label}`, { actorId: admin.id, entityType: kind, entityId: id });
  revalidateInbox(kind, id);
  return { ok: true, message: "Note added." };
});

export const deleteNoteAction = adminAction(async (admin, noteIdArg: string) => {
  const noteId = idSchema.parse(noteIdArg);
  const note = await prisma.internalNote.findUnique({ where: { id: noteId } });
  if (!note) throw new AdminError("That note was already deleted.");
  if (note.authorId !== admin.id) throw new AdminError("You can only delete notes you wrote.");
  const kind: InboxKind | null = note.quoteRequestId
    ? "quote"
    : note.customRequestId
      ? "custom_request"
      : note.contactMessageId
        ? "message"
        : note.orderId
          ? "order"
          : note.invoiceId
            ? "invoice"
            : note.customerId
              ? "customer"
              : null;
  const targetId = note.quoteRequestId ?? note.customRequestId ?? note.contactMessageId ?? note.orderId ?? note.invoiceId ?? note.customerId ?? undefined;
  await prisma.internalNote.delete({ where: { id: noteId } });
  await logActivity("note.deleted", `${admin.name} deleted an internal note`, {
    actorId: admin.id,
    entityType: kind ?? undefined,
    entityId: targetId,
  });
  if (kind && targetId) revalidateInbox(kind, targetId);
  return { ok: true, message: "Note deleted." };
});

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

async function applyStatus(admin: { id: string; name: string }, kindArg: InboxKind, idArg: string, statusArg: unknown) {
  const kind = assertKind(kindArg);
  const id = idSchema.parse(idArg);
  if (INBOX_KIND_META[kind].statuses.length === 0) throw new AdminError("Change this record's status from its own page.");
  const allowed = INBOX_KIND_META[kind].statuses as [string, ...string[]];
  const { status } = z.object({ status: z.enum(allowed, { error: "Choose a valid status." }) }).parse({ status: statusArg });
  const target = await loadTarget(kind, id);
  if (target.status === status) return { ok: true, message: "Status unchanged." };

  const event = { fromStatus: target.status, toStatus: status, authorId: admin.id, [FK[kind]]: id };
  const now = new Date();
  switch (kind) {
    case "custom_request":
      await prisma.$transaction([
        prisma.customRequest.update({ where: { id }, data: { status: status as CustomRequestStatus, readAt: target.readAt ?? now } }),
        prisma.statusEvent.create({ data: event }),
      ]);
      await logActivity("custom_request.status_changed", `${target.label} marked ${statusLabel(status)}`, {
        actorId: admin.id,
        entityType: "custom_request",
        entityId: id,
      });
      break;
    case "message":
      await prisma.$transaction([
        prisma.contactMessage.update({
          where: { id },
          data: { status: status as MessageStatus, readAt: status === "UNREAD" ? null : (target.readAt ?? now) },
        }),
        prisma.statusEvent.create({ data: event }),
      ]);
      await logActivity("message.status_changed", `${target.label} marked ${statusLabel(status)}`, { actorId: admin.id, entityType: "message", entityId: id });
      break;
    default:
      throw new AdminError("Change this record's status from its own page.");
  }
  revalidateInbox(kind, id);
  return { ok: true, message: `Status updated to ${statusLabel(status)}.` };
}

/** Status select + save form (field name "status"). */
export const changeStatusAction = adminAction(async (admin, kind: InboxKind, id: string, formData: FormData) =>
  applyStatus(admin, kind, id, fd.str(formData, "status")),
);

/** One-click status buttons (e.g. "Mark replied", "Archive"). */
export const setStatusAction = adminAction(async (admin, kind: InboxKind, id: string, status: string) => applyStatus(admin, kind, id, status));
