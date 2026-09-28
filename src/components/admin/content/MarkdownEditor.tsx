"use client";

import { useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import { useAdminForm } from "@/components/admin/forms";

/**
 * Markdown textarea with a Write / Preview toggle. The preview uses the same
 * renderer and `prose-wm` styles as the public site (raw HTML is escaped).
 */
export function MarkdownEditor({
  name,
  label,
  defaultValue,
  rows = 16,
  help,
  maxLength = 50000,
  required,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  rows?: number;
  help?: React.ReactNode;
  maxLength?: number;
  required?: boolean;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [mode, setMode] = useState<"write" | "preview">("write");
  const id = useId();
  const { fieldErrors } = useAdminForm();
  const error = fieldErrors[name];

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-end justify-between gap-2">
        <label htmlFor={`${id}-ta`} className="block text-sm font-medium text-neutral-800">
          {label}
          {required ? <span className="ml-0.5 text-red-600" aria-hidden="true">*</span> : null}
        </label>
        <div role="group" aria-label={`${label} view`} className="inline-flex rounded border border-neutral-300 bg-white p-0.5 text-xs">
          {(["write", "preview"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn("rounded px-2.5 py-1 font-medium capitalize", mode === m ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100")}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      {/* The textarea stays mounted (hidden in preview) so its value is always submitted. */}
      <textarea
        id={`${id}-ta`}
        name={name}
        rows={rows}
        value={value}
        maxLength={maxLength}
        onChange={(e) => setValue(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-help${error ? ` ${id}-err` : ""}`}
        hidden={mode === "preview"}
        className="block w-full rounded border border-neutral-300 bg-white px-3 py-2 font-mono text-[0.8125rem] leading-relaxed text-neutral-900 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 aria-[invalid=true]:border-red-500"
      />
      {mode === "preview" ? (
        <div className="min-h-40 rounded border border-neutral-200 bg-white px-5 py-4" aria-live="polite">
          {value.trim() ? (
            <div className="prose-wm max-w-none text-neutral-800">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null, h1: ({ children }) => <h2>{children}</h2> }}>
                {value}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-neutral-500">Nothing to preview yet.</p>
          )}
        </div>
      ) : null}
      <p id={`${id}-help`} className="mt-1 text-xs text-neutral-500">
        {help ?? (
          <>
            Markdown: <code>## Heading</code>, <code>**bold**</code>, <code>*italic*</code>, <code>- list item</code>, <code>[link text](/contact)</code>. Leave a blank line between paragraphs.
          </>
        )}
      </p>
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
