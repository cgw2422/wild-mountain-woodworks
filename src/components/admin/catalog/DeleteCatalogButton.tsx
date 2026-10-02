"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/admin/types";
import { cn } from "@/lib/cn";
import { Dialog } from "@/components/admin/forms";
import { adminButton } from "@/components/admin/ui";
import { catalogDeletionImpact, type CatalogImpact, type CatalogItemKind } from "@/app/admin/(panel)/catalog-impact";

const MAX_LISTED = 8;

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.75 6.5v4.5M9.25 6.5v4.5" />
    </svg>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Delete an option group, option value, add-on or add-on choice — with a
 * confirmation that first loads what it affects ("currently used by 4
 * products: …") and says plainly that saved quotes, orders and invoices are
 * not changed. Visually distinct from Edit (red, trash icon). Nothing is
 * deleted until the second, explicit click; the server action re-checks
 * permissions.
 */
export function DeleteCatalogButton({
  kind,
  id,
  noun,
  name,
  action,
  onDeleted,
  redirectTo,
  iconOnly = false,
  hideHint,
  className,
}: {
  kind: CatalogItemKind;
  id: string;
  /** e.g. "option group", "option value", "add-on", "chair style". */
  noun: string;
  name: string;
  action: () => Promise<ActionResult>;
  /** Called after a successful delete (e.g. drop it from unsaved editor state). */
  onDeleted?: () => void;
  redirectTo?: string;
  iconOnly?: boolean;
  /** Suggest a softer alternative, e.g. "Deactivate it instead to hide it for now." */
  hideHint?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<CatalogImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [pending, startDelete] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();

  function openDialog() {
    setOpen(true);
    setError(null);
    setImpact(null);
    startLoading(async () => {
      try {
        setImpact(await catalogDeletionImpact(kind, id));
      } catch {
        setError("Couldn't check where this is used. Please try again.");
      }
    });
  }

  function confirm() {
    setError(null);
    startDelete(async () => {
      try {
        const res = await action();
        if (!res.ok) {
          setError(res.message ?? "Something went wrong.");
          return;
        }
        setOpen(false);
        onDeleted?.();
        setDone(res.message ?? "Deleted.");
        setTimeout(() => setDone(null), 4000);
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } catch {
        setError("Network error. Please try again.");
      }
    });
  }

  const used = impact?.products.length ?? 0;
  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={cn(adminButton.small, "inline-flex items-center gap-1.5 border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50", className)}
        aria-label={`Delete ${noun} “${name}”`}
        title={`Delete ${noun}`}
      >
        <TrashIcon />
        {iconOnly ? <span className="sr-only">Delete</span> : "Delete"}
      </button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={`Delete ${noun} “${name}”?`}
        size="sm"
        footer={
          <>
            <button type="button" className={adminButton.secondary} onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </button>
            <button type="button" className={adminButton.danger} onClick={confirm} disabled={pending || loading || !impact?.found}>
              {pending ? "Deleting…" : `Delete ${noun}`}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-neutral-700">
          {loading || (!impact && !error) ? (
            <p className="text-neutral-500">Checking where it&apos;s used…</p>
          ) : impact && !impact.found ? (
            <p>It has already been deleted.</p>
          ) : impact ? (
            <>
              <p>
                This permanently deletes the {noun} <strong>{impact.name}</strong>.
              </p>
              {used ? (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  <p className="font-medium">
                    This {noun} is currently used by {plural(used, "product")}.
                  </p>
                  <ul className="mt-1 list-disc pl-5">
                    {impact.products.slice(0, MAX_LISTED).map((p, i) => (
                      <li key={i}>
                        {p.name}
                        {p.status !== "ACTIVE" ? <span className="text-amber-700"> ({p.status.toLowerCase()})</span> : null}
                      </li>
                    ))}
                    {used > MAX_LISTED ? <li>and {used - MAX_LISTED} more</li> : null}
                  </ul>
                  <p className="mt-1">It will be removed from {used === 1 ? "that product" : "those products"}.</p>
                </div>
              ) : (
                <p>No products use it right now.</p>
              )}
              {impact.addOns.length ? (
                <p>
                  It&apos;s also part of {plural(impact.addOns.length, "add-on")}: {impact.addOns.join(", ")}.
                </p>
              ) : null}
              {kind === "optionGroup" && impact.childCount ? <p>Its {plural(impact.childCount, "value")} will be deleted too.</p> : null}
              {kind === "addOn" && impact.childCount ? <p>Its {plural(impact.childCount, "configuration group")} will be detached (the groups stay in the option library).</p> : null}
              {impact.priceRules ? <p>{plural(impact.priceRules, "conditional price rule")} will be removed.</p> : null}
              <p>It can&apos;t be chosen on new product configurations or quotes after this.</p>
              <p className="rounded bg-neutral-50 px-3 py-2 text-neutral-600">
                Existing quotes, orders and invoices are <strong>not</strong> changed — they keep the names, choices, quantities and prices saved when they were created.
              </p>
              <p className="text-neutral-500">This can&apos;t be undone.{hideHint ? ` ${hideHint}` : ""}</p>
            </>
          ) : null}
          {error ? (
            <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      </Dialog>
      {done ? (
        <div role="status" className="fixed bottom-5 right-5 z-50 max-w-sm rounded-md bg-neutral-900 px-4 py-3 text-sm text-white shadow-lg">
          {done}
        </div>
      ) : null}
    </>
  );
}
