"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { formDataToObject, type FormState } from "@/lib/validation/shared";

/**
 * Submits a public form to a server action without resetting the user's
 * input on errors, blocks duplicate submissions, handles network failures and
 * moves focus to the first invalid field (or the error summary).
 */
export function usePublicForm(
  action: (fd: FormData) => Promise<FormState>,
  opts: { prepare?: (fd: FormData) => void; validate?: (fd: FormData) => Record<string, string> | null; onSuccess?: (s: FormState) => void } = {},
) {
  const [state, setState] = useState<FormState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);

  const focusFirstError = useCallback((errors?: Record<string, string>) => {
    requestAnimationFrame(() => {
      const form = formRef.current;
      if (!form) return;
      const key = errors ? Object.keys(errors)[0] : undefined;
      const el = key ? form.querySelector<HTMLElement>(`[name="${CSS.escape(key)}"]`) : null;
      (el ?? form.querySelector<HTMLElement>("[data-form-error]"))?.focus();
    });
  }, []);

  const onSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (inFlight.current) return;
      const fd = new FormData(e.currentTarget);
      opts.prepare?.(fd);
      const clientErrors = opts.validate?.(fd);
      if (clientErrors && Object.keys(clientErrors).length) {
        setState({ status: "error", message: "Please check the highlighted fields.", fieldErrors: clientErrors });
        focusFirstError(clientErrors);
        return;
      }
      inFlight.current = true;
      startTransition(async () => {
        try {
          const res = await action(fd);
          setState(res);
          if (res.status === "error") focusFirstError(res.fieldErrors);
          if (res.status === "success") opts.onSuccess?.(res);
        } catch {
          setState({
            status: "error",
            message: "We couldn't reach the server. Please check your connection and try again — your details are still here.",
          });
          focusFirstError();
        } finally {
          inFlight.current = false;
        }
      });
    },
    [action, opts, focusFirstError],
  );

  const fieldErrors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return { state, setState, pending, onSubmit, formRef, fieldErrors };
}

/** Client-side convenience validation (the server re-validates with Zod). */
export function clientValidator(rules: (values: Record<string, string>) => Record<string, string> | null) {
  return (fd: FormData) => rules(formDataToObject(fd));
}
