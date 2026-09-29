"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/admin/types";
import { adminButton } from "@/components/admin/ui";

/** Duplicate the estimate, then open the copy for editing. */
export function DuplicateAndOpen({ action }: { action: () => Promise<ActionResult> }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className={adminButton.secondary}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await action();
          if (res.ok && res.id) router.push(`/admin/pricing-calculator/${res.id}`);
        })
      }
    >
      {pending ? "Duplicating…" : "Duplicate"}
    </button>
  );
}
