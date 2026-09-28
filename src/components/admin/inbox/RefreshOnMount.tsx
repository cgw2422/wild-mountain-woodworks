"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Refreshes server components once after mount. Used after a page marks a
 * record as read during render, so the sidebar's unread count (rendered by
 * the shared layout) catches up.
 */
export function RefreshOnMount() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);
  return null;
}
