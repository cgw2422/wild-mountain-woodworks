"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { adminButton } from "@/components/admin/ui";
import type { ActionResult } from "@/lib/admin/types";

/**
 * Runs a server action, then navigates. Used for "Mark unread": staying on
 * the detail page would immediately mark the message read again.
 */
export function ActionThenNavigate({
  action,
  href,
  children,
  pendingLabel = "Saving…",
}: {
  action: () => Promise<ActionResult>;
  href: string;
  children: React.ReactNode;
  pendingLabel?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        className={adminButton.secondary}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              const res = await action();
              if (!res.ok) setError(res.message ?? "Something went wrong.");
              else router.push(href);
            } catch {
              setError("Network error. Please try again.");
            }
          })
        }
      >
        {pending ? pendingLabel : children}
      </button>
      {error ? (
        <div role="alert" className="fixed bottom-5 right-5 z-50 rounded-md bg-red-700 px-4 py-3 text-sm text-white shadow-lg">
          {error}
        </div>
      ) : null}
    </>
  );
}
