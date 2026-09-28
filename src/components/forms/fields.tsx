"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { HONEYPOT_FIELD_NAME, STARTED_AT_FIELD_NAME } from "@/lib/validation/honeypot";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES, IMAGE_ACCEPT, precheckImageFile } from "@/lib/media/validate";

const control =
  "block w-full border border-stone-dark/70 bg-paper px-4 text-[0.98rem] text-charcoal placeholder:text-muted-light transition-colors focus:border-charcoal focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 aria-[invalid=true]:border-error";

interface BaseProps {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
}

function Wrapper({
  id,
  label,
  error,
  hint,
  required,
  className,
  children,
}: BaseProps & { id: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-2 block text-[0.78rem] font-semibold uppercase tracking-[0.12em] text-charcoal">
        {label}
        {required ? (
          <span className="text-bronze-text" aria-hidden="true">
            {" "}
            *
          </span>
        ) : (
          <span className="ml-1.5 font-normal normal-case tracking-normal text-muted">(optional)</span>
        )}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm font-medium text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint?: string, error?: string) {
  return [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

export function TextField({
  label,
  name,
  error,
  hint,
  required,
  className,
  ...rest
}: BaseProps & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name">) {
  const id = useId();
  return (
    <Wrapper id={id} label={label} name={name} error={error} hint={hint} required={required} className={className}>
      <input
        id={id}
        name={name}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(control, "h-12")}
        {...rest}
      />
    </Wrapper>
  );
}

export function TextAreaField({
  label,
  name,
  error,
  hint,
  required,
  className,
  rows = 5,
  ...rest
}: BaseProps & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "name">) {
  const id = useId();
  return (
    <Wrapper id={id} label={label} name={name} error={error} hint={hint} required={required} className={className}>
      <textarea
        id={id}
        name={name}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(control, "py-3 leading-relaxed")}
        {...rest}
      />
    </Wrapper>
  );
}

export function SelectField({
  label,
  name,
  error,
  hint,
  required,
  className,
  options,
  placeholder = "Select…",
  ...rest
}: BaseProps & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "name"> & { options: ReadonlyArray<{ value: string; label: string }>; placeholder?: string }) {
  const id = useId();
  return (
    <Wrapper id={id} label={label} name={name} error={error} hint={hint} required={required} className={className}>
      <div className="relative">
        <select
          id={id}
          name={name}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(control, "h-12 appearance-none pr-10")}
          {...rest}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg viewBox="0 0 12 8" className="pointer-events-none absolute right-4 top-1/2 h-2 w-3 -translate-y-1/2" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
          <path d="M1 1.5l5 5 5-5" />
        </svg>
      </div>
    </Wrapper>
  );
}

/** Invisible anti-spam fields: a honeypot and the time the form was rendered. */
export function AntiSpamFields() {
  const startedRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (startedRef.current) startedRef.current.value = String(Date.now());
  }, []);
  return (
    <>
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Leave this field empty
          <input type="text" name={HONEYPOT_FIELD_NAME} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <input ref={startedRef} type="hidden" name={STARTED_AT_FIELD_NAME} defaultValue="" />
    </>
  );
}

export function FormErrorSummary({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="alert" tabIndex={-1} data-form-error className="border-l-2 border-error bg-error/5 px-4 py-3 text-sm text-error focus:outline-none">
      {message}
    </div>
  );
}

export function SubmitButton({ pending, children, pendingLabel = "Sending…", className }: { pending: boolean; children: React.ReactNode; pendingLabel?: string; className?: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className={cn(
        "inline-flex min-h-14 items-center justify-center gap-3 bg-charcoal px-9 text-[0.74rem] font-semibold uppercase tracking-[0.16em] text-ivory transition-colors hover:bg-walnut disabled:opacity-70",
        className,
      )}
    >
      {pending ? (
        <>
          <span className="h-3.5 w-3.5 animate-spin rounded-full border border-ivory/40 border-t-ivory" aria-hidden="true" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * Optional customer reference images. Files are validated client-side for
 * convenience (type/size/count) and re-validated on the server.
 */
export function ReferenceImagesField({
  files,
  onChange,
  error,
  label = "Reference images",
  hint,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  error?: string;
  label?: string;
  hint?: string;
}) {
  const id = useId();
  const [localError, setLocalError] = useState<string | null>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function add(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const errors: string[] = [];
    const ok: File[] = [];
    for (const f of incoming) {
      const e = precheckImageFile(f, ATTACHMENT_MAX_BYTES);
      if (e) errors.push(e);
      else ok.push(f);
    }
    const next = [...files, ...ok].slice(0, ATTACHMENT_MAX_FILES);
    if (files.length + ok.length > ATTACHMENT_MAX_FILES) errors.push(`You can attach up to ${ATTACHMENT_MAX_FILES} images.`);
    setLocalError(errors.length ? errors.join(" ") : null);
    onChange(next);
  }

  const shownError = error ?? localError ?? undefined;
  return (
    <div>
      <p id={`${id}-label`} className="mb-2 block text-[0.78rem] font-semibold uppercase tracking-[0.12em] text-charcoal">
        {label} <span className="ml-1.5 font-normal normal-case tracking-normal text-muted">(optional)</span>
      </p>
      <p id={`${id}-hint`} className="mb-3 text-sm text-muted">
        {hint ?? `Photos of your space, sketches or inspiration. Up to ${ATTACHMENT_MAX_FILES} images (JPG, PNG, WebP), 10 MB each.`}
      </p>
      {files.length ? (
        <ul className="mb-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="relative">
              {previews[i] ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                <img src={previews[i]} alt={f.name} className="aspect-square w-full border border-stone object-cover" />
              ) : null}
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center bg-charcoal/85 text-ivory"
                aria-label={`Remove ${f.name}`}
              >
                <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {files.length < ATTACHMENT_MAX_FILES ? (
        <label
          htmlFor={id}
          className="inline-flex min-h-12 cursor-pointer items-center gap-3 border border-dashed border-stone-dark px-5 text-sm text-charcoal transition-colors hover:border-charcoal focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-bronze-text"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
            <path d="M10 14V3m0 0L6 7m4-4l4 4M3 14v2.5A.5.5 0 003.5 17h13a.5.5 0 00.5-.5V14" />
          </svg>
          Add images
          <input
            id={id}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            className="sr-only"
            aria-describedby={`${id}-hint${shownError ? ` ${id}-error` : ""}`}
            onChange={(e) => {
              add(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      ) : null}
      {shownError ? (
        <p id={`${id}-error`} className="mt-2 text-sm font-medium text-error">
          {shownError}
        </p>
      ) : null}
    </div>
  );
}
