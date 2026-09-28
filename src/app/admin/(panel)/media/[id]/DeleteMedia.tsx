"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/admin/types";
type MediaUsage = { label: string; href: string };
import { Dialog } from "@/components/admin/forms";
import { adminButton } from "@/components/admin/ui";
import { REPLACE_INPUT_ID } from "./ReplaceFile";

/**
 * Safe delete: unused images are deleted after a confirmation; images in use
 * show every location and offer "Replace instead" or an explicit
 * "Remove from all locations and delete".
 */
export function DeleteMedia({
  name,
  usage,
  onDelete,
}: {
  name: string;
  usage: MediaUsage[];
  onDelete: (force: boolean) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const used = usage.length > 0;

  function close() {
    if (pending) return;
    setOpen(false);
    setUnderstood(false);
    setError(null);
  }

  function run(force: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await onDelete(force);
        if (!res.ok) {
          setError(res.message ?? "The image could not be deleted.");
          return;
        }
        router.push("/admin/media");
        router.refresh();
      } catch {
        setError("Network error. Please try again.");
      }
    });
  }

  return (
    <>
      <button type="button" className={adminButton.danger} onClick={() => setOpen(true)}>
        Delete image
      </button>
      <Dialog
        open={open}
        onClose={close}
        title={used ? `This image is currently used in ${usage.length} location${usage.length === 1 ? "" : "s"}` : "Delete this image?"}
        size="md"
        footer={
          used ? (
            <>
              <button type="button" className={adminButton.secondary} onClick={close} disabled={pending}>
                Cancel
              </button>
              <button
                type="button"
                className={adminButton.secondary}
                disabled={pending}
                onClick={() => {
                  close();
                  requestAnimationFrame(() => {
                    const el = document.getElementById(REPLACE_INPUT_ID);
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                    el?.focus();
                  });
                }}
              >
                Replace instead
              </button>
              <button type="button" className={adminButton.danger} disabled={pending || !understood} onClick={() => run(true)}>
                {pending ? "Deleting…" : "Remove from all locations and delete"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={adminButton.secondary} onClick={close} disabled={pending}>
                Cancel
              </button>
              <button type="button" className={adminButton.danger} disabled={pending} onClick={() => run(false)}>
                {pending ? "Deleting…" : "Delete permanently"}
              </button>
            </>
          )
        }
      >
        <div className="space-y-3 text-sm text-neutral-700">
          {used ? (
            <>
              <p>
                Deleting <strong className="break-all">{name}</strong> would remove it from these places. Consider <strong>replacing</strong> the file instead — every location
                keeps working and shows the new photo.
              </p>
              <ul className="max-h-56 list-disc space-y-1 overflow-y-auto rounded border border-neutral-200 bg-neutral-50 py-2 pl-8 pr-3">
                {usage.map((u, i) => (
                  <li key={`${u.href}-${i}`}>
                    <Link href={u.href} className="underline hover:text-neutral-900">
                      {u.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <p>
                If you delete anyway, galleries drop this photo and single-image spots (section images, category tiles, social images) are left empty until you choose a
                new image.
              </p>
              <label className="flex items-start gap-2 rounded border border-red-200 bg-red-50 p-3 text-red-900">
                <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5 h-4 w-4" />
                <span>I understand this image will be removed from all {usage.length} location{usage.length === 1 ? "" : "s"} and deleted permanently.</span>
              </label>
            </>
          ) : (
            <p>
              <strong className="break-all">{name}</strong> isn&apos;t used anywhere on the site. Deleting it removes the file permanently — this can&apos;t be undone.
            </p>
          )}
          {error ? (
            <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
