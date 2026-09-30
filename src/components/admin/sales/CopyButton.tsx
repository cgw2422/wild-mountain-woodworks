"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { adminButton } from "@/components/admin/ui";

/** Copy a value (e.g. a customer link) to the clipboard. */
export function CopyButton({ value, label = "Copy link", className, variant = "secondary" }: { value: string; label?: string; className?: string; variant?: keyof typeof adminButton }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cn(adminButton[variant], className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this link:", value);
        }
      }}
    >
      <span aria-live="polite">{copied ? "Copied!" : label}</span>
    </button>
  );
}
