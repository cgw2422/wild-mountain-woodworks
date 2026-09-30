"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/lib/admin/types";
import { adminButton } from "./ui";

/* -------------------------------------------------------------------------- */
/* ActionForm                                                                  */
/* -------------------------------------------------------------------------- */

type FormCtx = { fieldErrors: Record<string, string>; pending: boolean };
const FormContext = createContext<FormCtx>({ fieldErrors: {}, pending: false });
export const useAdminForm = () => useContext(FormContext);

/**
 * Admin form wrapper around a server action.
 * - does NOT reset fields on error (unlike a bare `<form action>`)
 * - shows success/error feedback and field-level errors
 * - prevents duplicate submissions while pending
 */
export function ActionForm({
  action,
  children,
  className,
  successMessage = "Saved.",
  onSuccess,
  redirectTo,
  resetOnSuccess,
  id,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  successMessage?: string | null;
  onSuccess?: (result: ActionResult) => void;
  redirectTo?: string | ((result: ActionResult) => string);
  resetOnSuccess?: boolean;
  id?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const formData = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(async () => {
      try {
        const res = await action(formData);
        setResult(res);
        if (res.ok) {
          if (resetOnSuccess) formRef.current?.reset();
          onSuccess?.(res);
          if (redirectTo) router.push(typeof redirectTo === "function" ? redirectTo(res) : redirectTo);
          else router.refresh();
        } else {
          // Move focus to the first invalid field for keyboard/screen-reader users.
          requestAnimationFrame(() => {
            const first = res.fieldErrors && Object.keys(res.fieldErrors)[0];
            const el = first ? formRef.current?.querySelector<HTMLElement>(`[name="${CSS.escape(first)}"]`) : null;
            el?.focus();
          });
        }
      } catch {
        setResult({ ok: false, message: "Network error — your changes were not saved. Please try again." });
      }
    });
  }

  return (
    <FormContext.Provider value={{ fieldErrors: result?.ok === false ? (result.fieldErrors ?? {}) : {}, pending }}>
      <form ref={formRef} onSubmit={onSubmit} className={className} noValidate id={id} aria-busy={pending}>
        {children}
        <FormFeedback result={result} successMessage={successMessage} onDismiss={() => setResult(null)} />
      </form>
    </FormContext.Provider>
  );
}

function FormFeedback({ result, successMessage, onDismiss }: { result: ActionResult | null; successMessage?: string | null; onDismiss: () => void }) {
  useEffect(() => {
    if (result?.ok) {
      const t = setTimeout(onDismiss, 3500);
      return () => clearTimeout(t);
    }
  }, [result, onDismiss]);
  if (!result) return null;
  if (result.ok && !successMessage && !result.message) return null;
  return (
    <div
      role={result.ok ? "status" : "alert"}
      className={cn(
        "fixed bottom-5 right-5 z-50 max-w-sm rounded-md px-4 py-3 text-sm shadow-lg",
        result.ok ? "bg-neutral-900 text-white" : "bg-red-700 text-white",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex-1">{result.message ?? (result.ok ? successMessage : "Something went wrong.")}</span>
        <button type="button" onClick={onDismiss} className="-mr-1 px-1 opacity-80 hover:opacity-100" aria-label="Dismiss">
          ×
        </button>
      </div>
    </div>
  );
}

export function SubmitButton({
  children = "Save",
  pendingLabel = "Saving…",
  variant = "primary",
  className,
  name,
  value,
}: {
  children?: React.ReactNode;
  pendingLabel?: string;
  variant?: keyof typeof adminButton;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useAdminForm();
  return (
    <button type="submit" disabled={pending} className={cn(adminButton[variant], className)} name={name} value={value}>
      {pending ? pendingLabel : children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Fields                                                                      */
/* -------------------------------------------------------------------------- */

const inputBase =
  "block w-full rounded border border-neutral-300 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 disabled:bg-neutral-50 aria-[invalid=true]:border-red-500";

export function Field({
  label,
  name,
  help,
  children,
  className,
  required,
  error: explicitError,
  id,
}: {
  label: React.ReactNode;
  name: string;
  help?: React.ReactNode;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => React.ReactNode;
  className?: string;
  required?: boolean;
  error?: string;
  id?: string;
}) {
  const autoId = useId();
  const fieldId = id ?? `f-${name}-${autoId}`;
  const { fieldErrors } = useAdminForm();
  const error = explicitError ?? fieldErrors[name];
  const describedBy = [help ? `${fieldId}-help` : null, error ? `${fieldId}-err` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={fieldId} className="mb-1.5 block text-sm font-medium text-neutral-800">
        {label}
        {required ? <span className="ml-0.5 text-red-600" aria-hidden="true">*</span> : null}
      </label>
      {children({ id: fieldId, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {help ? (
        <p id={`${fieldId}-help`} className="mt-1 text-xs text-neutral-500">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={`${fieldId}-err`} className="mt-1 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "name"> & {
  label: React.ReactNode;
  name: string;
  help?: React.ReactNode;
  wrapperClassName?: string;
};

export function TextInput({ label, name, help, wrapperClassName, className, required, ...rest }: InputProps) {
  return (
    <Field label={label} name={name} help={help} className={wrapperClassName} required={required}>
      {(a) => <input name={name} required={required} className={cn(inputBase, "h-10", className)} {...a} {...rest} />}
    </Field>
  );
}

export function MoneyInput({ label, name, help, wrapperClassName, className, ...rest }: InputProps) {
  return (
    <Field label={label} name={name} help={help} className={wrapperClassName}>
      {(a) => (
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-neutral-500">$</span>
          <input name={name} inputMode="decimal" className={cn(inputBase, "h-10 pl-7 tabular-nums", className)} {...a} {...rest} />
        </div>
      )}
    </Field>
  );
}

export function TextArea({
  label,
  name,
  help,
  wrapperClassName,
  className,
  rows = 4,
  required,
  ...rest
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "name"> & {
  label: React.ReactNode;
  name: string;
  help?: React.ReactNode;
  wrapperClassName?: string;
}) {
  return (
    <Field label={label} name={name} help={help} className={wrapperClassName} required={required}>
      {(a) => <textarea name={name} rows={rows} required={required} className={cn(inputBase, "py-2 leading-relaxed", className)} {...a} {...rest} />}
    </Field>
  );
}

export function Select({
  label,
  name,
  help,
  wrapperClassName,
  className,
  options,
  placeholder,
  ...rest
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "name"> & {
  label: React.ReactNode;
  name: string;
  help?: React.ReactNode;
  wrapperClassName?: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <Field label={label} name={name} help={help} className={wrapperClassName}>
      {(a) => (
        <select name={name} className={cn(inputBase, "h-10 pr-8", className)} {...a} {...rest}>
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Checkbox styled as a toggle row. Submits "on" when checked. */
export function Toggle({
  label,
  name,
  description,
  defaultChecked,
  checked,
  onChange,
  disabled,
  className,
}: {
  label: React.ReactNode;
  name?: string;
  description?: React.ReactNode;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0">
        <input
          id={id}
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          checked={checked}
          onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
          disabled={disabled}
          className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full bg-neutral-300 transition checked:bg-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
          aria-describedby={description ? `${id}-d` : undefined}
        />
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
      </span>
      <span className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium text-neutral-800">
          {label}
        </label>
        {description ? (
          <span id={`${id}-d`} className="block text-xs text-neutral-500">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Dialogs                                                                     */
/* -------------------------------------------------------------------------- */

/** Accessible modal built on native <dialog> (focus trap + Esc handled by the browser). */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const width = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // React propagates dialog events through the component tree, so a nested
      // dialog (e.g. the image picker inside a value editor) closing would also
      // close this one. Only react to events from this dialog itself.
      onClose={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onCancel={(e) => {
        if (e.target !== ref.current) return;
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn("m-auto w-[calc(100%-2rem)] rounded-lg bg-white p-0 shadow-2xl backdrop:bg-neutral-900/50", width)}
    >
      {open ? (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
            <h2 id={titleId} className="text-base font-semibold text-neutral-900">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900" aria-label="Close">
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-200 px-5 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

/**
 * A button that asks for confirmation, then runs a server action.
 * Use for destructive or significant operations (archive, delete, publish).
 */
export function ConfirmAction({
  action,
  label,
  title,
  body,
  confirmLabel = "Confirm",
  variant = "secondary",
  confirmVariant = "danger",
  className,
  onDone,
  redirectTo,
  successMessage,
}: {
  action: () => Promise<ActionResult>;
  label: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  variant?: keyof typeof adminButton;
  confirmVariant?: keyof typeof adminButton;
  className?: string;
  onDone?: (r: ActionResult) => void;
  redirectTo?: string;
  successMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (!res.ok) {
          setError(res.message ?? "Something went wrong.");
          return;
        }
        setOpen(false);
        onDone?.(res);
        if (successMessage) {
          setDone(successMessage);
          setTimeout(() => setDone(null), 3000);
        }
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } catch {
        setError("Network error. Please try again.");
      }
    });
  }

  return (
    <>
      <button type="button" className={cn(adminButton[variant], className)} onClick={() => setOpen(true)}>
        {label}
      </button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={title}
        size="sm"
        footer={
          <>
            <button type="button" className={adminButton.secondary} onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </button>
            <button type="button" className={adminButton[confirmVariant]} onClick={run} disabled={pending}>
              {pending ? "Working…" : confirmLabel}
            </button>
          </>
        }
      >
        {body ? <div className="text-sm text-neutral-700">{body}</div> : null}
        {error ? (
          <p role="alert" className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </Dialog>
      {done ? (
        <div role="status" className="fixed bottom-5 right-5 z-50 rounded-md bg-neutral-900 px-4 py-3 text-sm text-white shadow-lg">
          {done}
        </div>
      ) : null}
    </>
  );
}

/** Run a server action from a plain button (no confirmation). */
export function ActionButton({
  action,
  children,
  variant = "secondary",
  className,
  pendingLabel,
  successMessage,
  title,
}: {
  action: () => Promise<ActionResult>;
  children: React.ReactNode;
  variant?: keyof typeof adminButton;
  className?: string;
  pendingLabel?: string;
  successMessage?: string;
  title?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <>
      <button
        type="button"
        title={title}
        disabled={pending}
        className={cn(adminButton[variant], className)}
        onClick={() =>
          startTransition(async () => {
            try {
              const res = await action();
              if (!res.ok) setMsg({ ok: false, text: res.message ?? "Something went wrong." });
              else {
                if (successMessage || res.message) setMsg({ ok: true, text: res.message ?? successMessage! });
                router.refresh();
              }
            } catch {
              setMsg({ ok: false, text: "Network error. Please try again." });
            }
          })
        }
      >
        {pending && pendingLabel ? pendingLabel : children}
      </button>
      {msg ? (
        <div role={msg.ok ? "status" : "alert"} className={cn("fixed bottom-5 right-5 z-50 rounded-md px-4 py-3 text-sm text-white shadow-lg", msg.ok ? "bg-neutral-900" : "bg-red-700")}>
          {msg.text}
        </div>
      ) : null}
    </>
  );
}
