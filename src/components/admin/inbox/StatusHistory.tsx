import { formatDate } from "@/components/admin/ui";
import { statusLabel } from "./kinds";
import { RelativeTime } from "./time";

export type StatusEventView = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  createdAt: Date;
  author: { name: string } | null;
  /** Set when a person made the change; null for automatic (workflow/payment) changes. */
  authorId?: string | null;
};

/** Chronological status timeline (oldest first, like a history log). */
export function StatusHistory({
  events,
  label = statusLabel,
  originLabel = "Submitted by customer",
}: {
  events: StatusEventView[];
  label?: (s: string) => string;
  /** Attribution for the initial, author-less event. */
  originLabel?: string;
}) {
  if (events.length === 0) return <p className="text-sm text-neutral-500">No status changes recorded yet.</p>;
  return (
    <ol className="relative space-y-4 border-l border-neutral-200 pl-5">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-neutral-400 ring-1 ring-neutral-300" aria-hidden="true" />
          <p className="text-sm text-neutral-900">
            {e.fromStatus ? (
              <>
                <span className="text-neutral-500">{label(e.fromStatus)}</span> <span aria-hidden="true">→</span>
                <span className="sr-only">changed to</span> <span className="font-medium">{label(e.toStatus)}</span>
              </>
            ) : (
              <>
                Started as <span className="font-medium">{label(e.toStatus)}</span>
              </>
            )}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {e.author ? e.author.name : e.authorId ? "Removed admin user" : e.fromStatus ? "Automatic" : originLabel} · <RelativeTime date={e.createdAt} />{" "}
            <span className="sr-only">({formatDate(e.createdAt, true)})</span>
          </p>
        </li>
      ))}
    </ol>
  );
}
