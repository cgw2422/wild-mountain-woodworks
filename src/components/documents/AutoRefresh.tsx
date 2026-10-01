"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-render the page every few seconds for a while (waiting on a webhook). */
export function AutoRefresh({ everyMs = 4000, forMs = 60000 }: { everyMs?: number; forMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > forMs) clearInterval(t);
      else router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [router, everyMs, forMs]);
  return null;
}
