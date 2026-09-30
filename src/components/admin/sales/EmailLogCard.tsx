import { Badge, Card, formatDate } from "@/components/admin/ui";
import { ActionButton } from "@/components/admin/forms";
import { resendEmailAction } from "@/app/admin/(panel)/sales-actions";

type Log = { id: string; template: string; to: string; subject: string; status: string; error: string | null; createdAt: Date; sentAt: Date | null; attempts: number };

/** Emails sent for a record, with delivery status and resend. */
export function EmailLogCard({ emails, title = "Emails" }: { emails: Log[]; title?: string }) {
  return (
    <Card title={title} description={emails.length ? undefined : "No emails yet."} bodyClassName={emails.length ? "p-0" : "hidden"}>
      <ul className="divide-y divide-neutral-100">
        {emails.map((e) => (
          <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium [overflow-wrap:anywhere]">{e.subject}</p>
              <p className="text-xs text-neutral-500">
                To {e.to} · {formatDate(e.sentAt ?? e.createdAt, true)}
                {e.attempts > 1 ? ` · ${e.attempts} attempts` : ""}
              </p>
              {e.error ? <p className="mt-1 text-xs text-red-700">{e.error}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={e.status === "SENT" ? "green" : e.status === "FAILED" ? "red" : "amber"}>{e.status === "SENT" ? "Sent" : e.status === "FAILED" ? "Failed" : "Pending"}</Badge>
              <ActionButton action={resendEmailAction.bind(null, e.id)} variant="small" pendingLabel="Sending…">
                Resend
              </ActionButton>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
