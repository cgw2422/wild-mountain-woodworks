"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { TextArea, TextInput } from "../forms";

function Counter({ length, recommended }: { length: number; recommended: number }) {
  const over = length > recommended;
  return (
    <span className={cn("tabular-nums", over ? "font-medium text-amber-700" : "text-neutral-500")}>
      {length}/{recommended}
      {over ? " — may be truncated in search results" : ""}
    </span>
  );
}

/** Text input with a live character counter (e.g. SEO title). */
export function CountedInput({
  label,
  name,
  defaultValue,
  recommended,
  placeholder,
  hint,
  maxLength,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  recommended: number;
  placeholder?: string;
  hint?: React.ReactNode;
  maxLength?: number;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  return (
    <TextInput
      label={label}
      name={name}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      help={
        <span className="flex flex-wrap justify-between gap-2">
          <span>{hint}</span>
          <Counter length={value.length} recommended={recommended} />
        </span>
      }
    />
  );
}

/** Textarea with a live character counter (e.g. SEO description). */
export function CountedTextArea({
  label,
  name,
  defaultValue,
  recommended,
  placeholder,
  hint,
  rows = 3,
  maxLength,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  recommended: number;
  placeholder?: string;
  hint?: React.ReactNode;
  rows?: number;
  maxLength?: number;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  return (
    <TextArea
      label={label}
      name={name}
      rows={rows}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      help={
        <span className="flex flex-wrap justify-between gap-2">
          <span>{hint}</span>
          <Counter length={value.length} recommended={recommended} />
        </span>
      }
    />
  );
}
