"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/lib/admin/types";
import { Dialog } from "../forms";
import { adminButton } from "../ui";

/**
 * Button that (optionally after confirmation) runs a server action and then
 * opens the record it returned — e.g. a duplicated product's editor
 * (`navigatePrefix` + result.id). Without an id the page is refreshed.
 */
export function RunActionButton({
  action,
  children,
  navigatePrefix,
  variant = "secondary",
  className,
  confirm,
  pendingLabel = "Working…",
}: {
  action: () => Promise<ActionResult>;
  children: React.ReactNode;
  navigatePrefix?: string;
  variant?: keyof typeof adminButton;
  className?: string;
  confirm?: { title: string; body?: React.ReactNode; confirmLabel?: string; confirmVariant?: keyof typeof adminButton };
  pendingLabel?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (!res.ok) {
          setError(res.message ?? "Something went wrong.");
          if (!confirm) setTimeout(() => setError(null), 4000);
          return;
        }
        setOpen(false);
        const to = navigatePrefix && res.id ? `${navigatePrefix}${res.id}` : null;
        if (to) router.push(to);
        else router.refresh();
      } catch {
        setError("Network error. Please try again.");
      }
    });
  }

  return (
    <>
      <button type="button" className={cn(adminButton[variant], className)} disabled={pending} onClick={() => (confirm ? setOpen(true) : run())}>
        {pending && !confirm ? pendingLabel : children}
      </button>
      {confirm ? (
        <Dialog
          open={open}
          onClose={() => !pending && setOpen(false)}
          title={confirm.title}
          size="sm"
          footer={
            <>
              <button type="button" className={adminButton.secondary} onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </button>
              <button type="button" className={adminButton[confirm.confirmVariant ?? "primary"]} onClick={run} disabled={pending}>
                {pending ? pendingLabel : (confirm.confirmLabel ?? "Confirm")}
              </button>
            </>
          }
        >
          {confirm.body ? <div className="text-sm text-neutral-700">{confirm.body}</div> : null}
          {error ? (
            <p role="alert" className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </Dialog>
      ) : error ? (
        <div role="alert" className="fixed bottom-5 right-5 z-50 max-w-sm rounded-md bg-red-700 px-4 py-3 text-sm text-white shadow-lg">
          {error}
        </div>
      ) : null}
    </>
  );
}
