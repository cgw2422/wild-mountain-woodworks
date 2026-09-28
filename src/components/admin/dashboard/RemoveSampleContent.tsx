"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/admin/forms";
import { adminButton } from "@/components/admin/ui";
import type { ActionResult } from "@/lib/admin/types";

export function RemoveSampleContent({
  action,
  summary,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  summary: { products: number; portfolio: number; media: number };
}) {
  const [open, setOpen] = useState(false);
  const [clearPageImages, setClearPageImages] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  function close() {
    if (pending) return;
    setOpen(false);
    setResult(null);
    setClearPageImages(false);
  }

  function run() {
    const data = new FormData();
    if (clearPageImages) data.set("clearPageImages", "on");
    startTransition(async () => {
      try {
        const res = await action(data);
        setResult(res);
        if (res.ok) router.refresh();
      } catch {
        setResult({ ok: false, message: "Network error — nothing was confirmed. Please try again." });
      }
    });
  }

  const done = result?.ok === true;
  return (
    <>
      <button type="button" className={adminButton.danger} onClick={() => setOpen(true)}>
        Remove sample content
      </button>
      <Dialog
        open={open}
        onClose={close}
        title={done ? "Sample content removed" : "Remove sample content?"}
        footer={
          done ? (
            <button type="button" className={adminButton.primary} onClick={close}>
              Close
            </button>
          ) : (
            <>
              <button type="button" className={adminButton.secondary} onClick={close} disabled={pending}>
                Cancel
              </button>
              <button type="button" className={adminButton.danger} onClick={run} disabled={pending}>
                {pending ? "Removing…" : "Remove sample content"}
              </button>
            </>
          )
        }
      >
        {done ? (
          <p role="status" className="text-sm text-neutral-800">
            {result.message}
          </p>
        ) : (
          <div className="space-y-4 text-sm text-neutral-700">
            <p>This removes the demonstration content that came with the site so only your real work is shown:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>{summary.products}</strong> sample product{summary.products === 1 ? "" : "s"} — deleted, or archived instead if a quote request or
                order refers to them.
              </li>
              <li>
                <strong>{summary.portfolio}</strong> sample portfolio project{summary.portfolio === 1 ? "" : "s"} — deleted.
              </li>
              <li>
                <strong>{summary.media}</strong> sample image{summary.media === 1 ? "" : "s"} — deleted from the media library and storage once nothing uses
                them.
              </li>
            </ul>
            <p>
              <strong>Kept:</strong> categories, options, add-ons, FAQs, pages and all text. Your own uploads are never touched.
            </p>
            <label className="flex cursor-pointer items-start gap-3 rounded border border-neutral-200 bg-neutral-50 p-3">
              <input
                type="checkbox"
                checked={clearPageImages}
                onChange={(e) => setClearPageImages(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-neutral-900"
              />
              <span>
                <span className="block font-medium text-neutral-900">Also remove sample images from pages and categories</span>
                <span className="block text-xs text-neutral-600">
                  Clears sample photos used by the homepage and other page sections, categories, option values, add-ons and social-share images, then
                  deletes them. Those spots will show no image until you choose a new one. Leave unchecked to keep them until you replace them yourself.
                </span>
              </span>
            </label>
            <p className="font-medium text-red-700">This can&apos;t be undone.</p>
            {result && !result.ok ? (
              <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">
                {result.message}
              </p>
            ) : null}
          </div>
        )}
      </Dialog>
    </>
  );
}
