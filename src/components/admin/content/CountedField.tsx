"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Field } from "@/components/admin/forms";

const inputBase =
  "block w-full rounded border border-neutral-300 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 aria-[invalid=true]:border-red-500";

/**
 * Text input / textarea with a live character counter. Turns amber past the
 * recommended length (e.g. where search engines truncate) — a guide, not a limit.
 */
export function CountedField({
  label,
  name,
  defaultValue,
  recommended,
  maxLength,
  help,
  multiline,
  rows = 3,
  placeholder,
  className,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  recommended: number;
  maxLength: number;
  help?: React.ReactNode;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  const [length, setLength] = useState((defaultValue ?? "").length);
  const over = length > recommended;
  return (
    <Field
      label={label}
      name={name}
      className={className}
      help={
        <span className="flex flex-wrap justify-between gap-2">
          <span>{help}</span>
          <span className={cn("tabular-nums", over ? "font-medium text-amber-700" : "text-neutral-500")} aria-live="polite">
            {length}/{recommended}
            {over ? " — may be cut off in search results" : ""}
          </span>
        </span>
      }
    >
      {(a) =>
        multiline ? (
          <textarea
            name={name}
            rows={rows}
            defaultValue={defaultValue ?? ""}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(e) => setLength(e.target.value.length)}
            className={cn(inputBase, "py-2 leading-relaxed")}
            {...a}
          />
        ) : (
          <input
            name={name}
            defaultValue={defaultValue ?? ""}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(e) => setLength(e.target.value.length)}
            className={cn(inputBase, "h-10")}
            {...a}
          />
        )
      }
    </Field>
  );
}
