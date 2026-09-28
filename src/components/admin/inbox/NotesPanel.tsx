import { deleteNoteAction } from "@/app/admin/(panel)/inbox-actions";
import { ActionForm, ConfirmAction, SubmitButton, TextArea } from "@/components/admin/forms";
import { Card, formatDate } from "@/components/admin/ui";
import type { ActionResult } from "@/lib/admin/types";
import { RelativeTime } from "./time";

export type NoteView = {
  id: string;
  body: string;
  createdAt: Date;
  authorId: string | null;
  author: { name: string } | null;
};

/**
 * Internal notes: never shown to customers. Newest first. Admins may delete
 * notes they wrote themselves.
 */
export function NotesPanel({
  notes,
  currentAdminId,
  addAction,
}: {
  notes: NoteView[];
  currentAdminId: string;
  /** addNoteAction bound to (kind, id). */
  addAction: (formData: FormData) => Promise<ActionResult>;
}) {
  return (
    <Card title="Internal notes" description="Only visible to admins.">
      <ActionForm action={addAction} resetOnSuccess successMessage="Note added." className="space-y-3">
        <TextArea label="Add a note" name="body" rows={3} maxLength={5000} placeholder="e.g. Called and left a voicemail about wood options." />
        <SubmitButton pendingLabel="Adding…">Add note</SubmitButton>
      </ActionForm>
      {notes.length === 0 ? (
        <p className="mt-5 text-sm text-neutral-500">No notes yet.</p>
      ) : (
        <ul className="mt-5 divide-y divide-neutral-100 border-t border-neutral-100">
          {notes.map((n) => (
            <li key={n.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-neutral-500">
                  <span className="font-medium text-neutral-700">{n.author?.name ?? "Removed admin user"}</span> · <RelativeTime date={n.createdAt} />
                </p>
                {n.authorId === currentAdminId ? (
                  <ConfirmAction
                    action={deleteNoteAction.bind(null, n.id)}
                    label={
                      <>
                        Delete<span className="sr-only"> your note from {formatDate(n.createdAt, true)}</span>
                      </>
                    }
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    title="Delete this note?"
                    body="The note will be permanently removed. This can't be undone."
                    confirmLabel="Delete note"
                    successMessage="Note deleted."
                  />
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-900 [overflow-wrap:anywhere]">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
