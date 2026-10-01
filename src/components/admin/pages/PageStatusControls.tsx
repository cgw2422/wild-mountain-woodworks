"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/admin/types";
import { ActionButton, ConfirmAction } from "@/components/admin/forms";
import { adminButton } from "@/components/admin/ui";

type Status = "PUBLISHED" | "DRAFT" | "ARCHIVED";

/**
 * Publish / Move to draft / Archive / Restore, Preview and Duplicate for one
 * page. Every button calls a server action that re-checks the role; this
 * component only decides what to offer.
 */
export function PageStatusControls({
  status,
  canChangeStatus,
  previewHref,
  setStatus,
  duplicate,
  warning,
}: {
  status: Status;
  canChangeStatus: boolean;
  previewHref: string | null;
  setStatus: ((next: Status) => Promise<ActionResult>) | null;
  duplicate: (() => Promise<ActionResult>) | null;
  /** Extra caution for important pages (shown in the confirmation, never blocks). */
  warning?: string;
}) {
  const caution = warning ? (
    <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
      <strong>Heads up:</strong> {warning}
    </p>
  ) : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canChangeStatus && setStatus ? (
        <>
          {status !== "PUBLISHED" ? (
            <ActionButton action={() => setStatus("PUBLISHED")} variant="primary" pendingLabel="Publishing…">
              {status === "ARCHIVED" ? "Restore & publish" : "Publish"}
            </ActionButton>
          ) : (
            <ConfirmAction
              action={() => setStatus("DRAFT")}
              label="Move to draft"
              title="Move this page to draft?"
              body={
                <>
                  <p>It disappears from the public site, every menu, breadcrumbs and the sitemap straight away. Visitors get a “page not found”. You can still edit and preview it, and publishing it again brings its menu links back.</p>
                  {caution}
                </>
              }
              confirmLabel="Move to draft"
              confirmVariant="primary"
            />
          )}
          {status === "ARCHIVED" ? (
            <ActionButton action={() => setStatus("DRAFT")} pendingLabel="Restoring…">
              Restore as draft
            </ActionButton>
          ) : (
            <ConfirmAction
              action={() => setStatus("ARCHIVED")}
              label="Archive"
              title="Archive this page?"
              body={
                <>
                  <p>It&apos;s removed from the public site, menus and sitemap and moved to the Archived list. Nothing is deleted — you can restore it later.</p>
                  {status === "PUBLISHED" ? caution : null}
                </>
              }
              confirmLabel="Archive"
            />
          )}
        </>
      ) : null}
      {previewHref ? (
        <a href={previewHref} target="_blank" rel="noopener" className={adminButton.secondary}>
          {status === "PUBLISHED" ? "View page ↗" : "Preview draft ↗"}
        </a>
      ) : null}
      {duplicate ? <DuplicateButton duplicate={duplicate} /> : null}
    </div>
  );
}

function DuplicateButton({ duplicate }: { duplicate: () => Promise<ActionResult> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        className={adminButton.secondary}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await duplicate();
            if (res.ok && res.id) router.push(`/admin/pages/${res.id}`);
            else setError(res.message ?? "Couldn't duplicate the page.");
          })
        }
      >
        {pending ? "Duplicating…" : "Duplicate"}
      </button>
      {error ? (
        <span role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </span>
      ) : null}
    </span>
  );
}
