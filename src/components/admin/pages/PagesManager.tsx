"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/admin/types";
import { cn } from "@/lib/cn";
import { Dialog } from "@/components/admin/forms";
import { Badge, StatusBadge, adminButton, formatDate, table } from "@/components/admin/ui";

type Status = "PUBLISHED" | "DRAFT" | "ARCHIVED";

export type PageRow = {
  slug: string;
  title: string;
  path: string;
  description: string | null;
  status: Status;
  /** False for the homepage and shared content blocks. */
  statusEditable: boolean;
  template: boolean;
  templateNote: string | null;
  editHref: string;
  reviewRequired: boolean;
  unpublishWarning: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
  updatedBy: string | null;
};

const ACTIONS: Array<{ status: Status; label: string; verb: string; variant: keyof typeof adminButton }> = [
  { status: "PUBLISHED", label: "Publish", verb: "publish", variant: "primary" },
  { status: "DRAFT", label: "Move to draft", verb: "move to draft", variant: "secondary" },
  { status: "ARCHIVED", label: "Archive", verb: "archive", variant: "secondary" },
];

/**
 * Admin → Pages: every page grouped, with row checkboxes and bulk
 * Publish / Move to draft / Archive. The server re-checks the role and
 * skips pages whose status can't change (the homepage, shared blocks).
 */
export function PagesManager({ groups, bulk }: { groups: Array<{ title: string; description: string; rows: PageRow[]; empty?: string }>; bulk: (slugs: string[], status: Status) => Promise<ActionResult> }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Status | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const allRows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const chosen = allRows.filter((r) => selected.has(r.slug));
  const toggle = (slug: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(slug);
      else next.delete(slug);
      return next;
    });

  const run = (status: Status) =>
    start(async () => {
      try {
        const res = await bulk([...selected], status);
        setMessage({ ok: res.ok, text: res.message ?? (res.ok ? "Done." : "Something went wrong.") });
        if (res.ok) {
          setSelected(new Set());
          setConfirm(null);
          router.refresh();
        }
      } catch {
        setMessage({ ok: false, text: "Network error. Please try again." });
      }
    });

  const warnings = confirm && confirm !== "PUBLISHED" ? chosen.filter((r) => r.status === "PUBLISHED" && r.unpublishWarning) : [];
  const action = ACTIONS.find((a) => a.status === confirm);

  return (
    <>
      <div
        className={cn(
          "sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-neutral-50/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-md sm:border",
          chosen.length ? "" : "hidden",
        )}
        role="region"
        aria-label="Bulk actions"
      >
        <span className="mr-2 text-sm font-medium">{chosen.length} selected</span>
        {ACTIONS.map((a) => (
          <button key={a.status} type="button" className={adminButton[a.variant]} disabled={pending} onClick={() => setConfirm(a.status)}>
            {a.label}
          </button>
        ))}
        <button type="button" className={adminButton.ghost} onClick={() => setSelected(new Set())}>
          Clear
        </button>
      </div>

      <div className="space-y-8">
        {groups
          .filter((g) => g.rows.length || g.empty)
          .map((g) => (
            <section key={g.title} aria-labelledby={`grp-${g.title}`}>
              <h2 id={`grp-${g.title}`} className="text-base font-semibold text-neutral-900">
                {g.title}
              </h2>
              <p className="mb-3 text-sm text-neutral-500">{g.description}</p>
              {g.rows.length ? (
                <PagesTable rows={g.rows} selected={selected} toggle={toggle} />
              ) : (
                <p className="rounded-md border border-dashed border-neutral-300 p-4 text-sm text-neutral-600">{g.empty}</p>
              )}
            </section>
          ))}
      </div>

      <Dialog
        open={Boolean(confirm)}
        onClose={() => !pending && setConfirm(null)}
        title={action ? `${action.label}: ${chosen.length} page${chosen.length === 1 ? "" : "s"}?` : ""}
        size="sm"
        footer={
          <>
            <button type="button" className={adminButton.secondary} onClick={() => setConfirm(null)} disabled={pending}>
              Cancel
            </button>
            <button type="button" className={adminButton.primary} onClick={() => confirm && run(confirm)} disabled={pending}>
              {pending ? "Working…" : action?.label}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-neutral-700">
          <ul className="list-disc space-y-0.5 pl-5">
            {chosen.map((r) => (
              <li key={r.slug}>
                {r.title}
                {!r.statusEditable ? <span className="text-neutral-500"> — skipped ({r.template ? "shared content block" : "always published"})</span> : null}
              </li>
            ))}
          </ul>
          {confirm === "PUBLISHED" ? (
            <p>They go live on the site straight away, and any menu items pointing at them reappear.</p>
          ) : (
            <p>
              They disappear from the public site, every menu, breadcrumbs and the sitemap straight away. Content and menu items are kept, and publishing again restores them.
            </p>
          )}
          {warnings.map((r) => (
            <p key={r.slug} className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
              <strong>{r.title}:</strong> {r.unpublishWarning}
            </p>
          ))}
        </div>
      </Dialog>

      {message ? (
        <div role={message.ok ? "status" : "alert"} className={cn("fixed bottom-5 right-5 z-50 max-w-sm rounded-md px-4 py-3 text-sm text-white shadow-lg", message.ok ? "bg-neutral-900" : "bg-red-700")}>
          <div className="flex items-start gap-3">
            <span className="flex-1">{message.text}</span>
            <button type="button" onClick={() => setMessage(null)} className="-mr-1 px-1 opacity-80 hover:opacity-100" aria-label="Dismiss">
              ×
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function PagesTable({ rows, selected, toggle }: { rows: PageRow[]; selected: Set<string>; toggle: (slug: string, on: boolean) => void }) {
  const selectable = rows.filter((r) => r.statusEditable);
  const allOn = selectable.length > 0 && selectable.every((r) => selected.has(r.slug));
  return (
    <div className={cn(table.wrap, "relative")}>
      <table className={table.table}>
        <thead className={table.thead}>
          <tr>
            <th scope="col" className={cn(table.th, "w-10")}>
              {selectable.length ? (
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={allOn}
                  onChange={(e) => selectable.forEach((r) => toggle(r.slug, e.target.checked))}
                  aria-label="Select all pages in this group"
                />
              ) : (
                <span className="sr-only">Select</span>
              )}
            </th>
            <th scope="col" className={table.th}>Title</th>
            <th scope="col" className={table.th}>Slug</th>
            <th scope="col" className={table.th}>Status</th>
            <th scope="col" className={table.th}>Last updated</th>
            <th scope="col" className={table.th}>Published</th>
            <th scope="col" className={table.th}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className={table.tbody}>
          {rows.map((r) => (
            <tr key={r.slug} className={cn(table.tr, selected.has(r.slug) && "bg-sky-50/60")}>
              <td className={table.td}>
                {r.statusEditable ? (
                  <input type="checkbox" className="h-5 w-5" checked={selected.has(r.slug)} onChange={(e) => toggle(r.slug, e.target.checked)} aria-label={`Select ${r.title}`} />
                ) : null}
              </td>
              <td className={table.td}>
                <Link href={r.editHref} className="inline-block py-1 font-medium text-neutral-900 hover:underline">
                  {r.title}
                </Link>
                {r.description ? <p className="text-xs text-neutral-500">{r.description}</p> : null}
                {r.reviewRequired ? (
                  <Badge tone="amber" className="mt-1">
                    Needs owner/legal review
                  </Badge>
                ) : null}
              </td>
              <td className={table.td}>
                {r.template ? <span className="text-xs text-neutral-500">{r.templateNote}</span> : <span className="whitespace-nowrap font-mono text-xs text-neutral-700">{r.path}</span>}
              </td>
              <td className={table.td}>
                {r.template ? <span className="text-xs text-neutral-500">—</span> : <StatusBadge status={r.status} />}
                {!r.statusEditable && !r.template ? <p className="mt-1 text-xs text-neutral-500">Always live</p> : null}
              </td>
              <td className={cn(table.td, "whitespace-nowrap text-neutral-600")}>
                {r.updatedAt ? formatDate(r.updatedAt, true) : "Never edited"}
                {r.updatedBy ? <p className="text-xs text-neutral-500">by {r.updatedBy}</p> : null}
              </td>
              <td className={cn(table.td, "whitespace-nowrap text-neutral-600")}>{r.status === "PUBLISHED" && r.publishedAt ? formatDate(r.publishedAt) : "—"}</td>
              <td className={cn(table.td, "whitespace-nowrap text-right")}>
                <span className="inline-flex gap-3">
                  {!r.template ? (
                    <a
                      href={r.status === "PUBLISHED" ? r.path : `/api/admin/preview?path=${encodeURIComponent(r.path)}`}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex min-h-11 min-w-11 items-center justify-center text-sm text-neutral-600 underline hover:text-neutral-900"
                    >
                      {r.status === "PUBLISHED" ? "View" : "Preview"}
                      <span className="sr-only"> {r.title} (opens in a new tab)</span>
                    </a>
                  ) : null}
                  <Link href={r.editHref} className="inline-flex min-h-11 min-w-11 items-center justify-center text-sm font-medium text-neutral-900 underline">
                    Edit<span className="sr-only"> {r.title}</span>
                  </Link>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
