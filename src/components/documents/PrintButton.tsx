"use client";

import { buttonClasses } from "@/components/ui/Button";

/** Print or "Save as PDF" from the browser's print dialog. */
export function PrintButton({ label = "Print / Save PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClasses("secondary", "md", "print:hidden")}>
      {label}
    </button>
  );
}
