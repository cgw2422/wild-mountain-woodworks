"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clientRules } from "@/lib/validation/shared";
import type { FormState } from "@/lib/validation/shared";
import { ACCEPT_DEPOSIT_LABEL, ACCEPT_NO_DEPOSIT_LABEL, ACCEPT_TERMS_LABEL } from "@/lib/sales/acceptance";
import { buttonClasses } from "@/components/ui/Button";
import { FormErrorSummary, SubmitButton, TextAreaField, TextField } from "@/components/forms/fields";
import { clientValidator, usePublicForm } from "@/components/forms/usePublicForm";

const validateAccept = clientValidator(clientRules.acceptQuote);
const validateDecline = clientValidator(clientRules.declineQuote);

/** Accept / decline / contact for the current quote revision. */
export function QuoteResponse({
  revision,
  hasDeposit,
  depositLabel,
  customerName,
  contactHref,
  accept,
  decline,
}: {
  revision: number;
  hasDeposit: boolean;
  depositLabel: string;
  customerName: string;
  contactHref: string;
  accept: (fd: FormData) => Promise<FormState>;
  decline: (fd: FormData) => Promise<FormState>;
}) {
  const [mode, setMode] = useState<"choose" | "accept" | "decline">("choose");
  const [done, setDone] = useState<{ kind: "accepted"; order?: string } | { kind: "declined" } | null>(null);
  const router = useRouter();

  if (done?.kind === "accepted") {
    return (
      <div role="status" className="border border-success bg-paper p-6 md:p-8">
        <h2 className="display-sm">Thank you — your quote is accepted.</h2>
        <p className="mt-3 text-muted">
          {done.order ? `Your order number is ${done.order}. ` : ""}We&apos;ve emailed you a confirmation{hasDeposit ? " and will send your deposit invoice shortly" : ""}.
        </p>
      </div>
    );
  }
  if (done?.kind === "declined") {
    return (
      <div role="status" className="border border-stone-dark bg-paper p-6 md:p-8">
        <h2 className="display-sm">Thank you for letting us know.</h2>
        <p className="mt-3 text-muted">We&apos;ve let the shop know. If anything changes, just get in touch — we&apos;d be glad to help.</p>
      </div>
    );
  }

  return (
    <section aria-label="Respond to this quote" className="border border-charcoal bg-paper p-6 print:hidden md:p-8">
      {mode === "choose" ? (
        <>
          <h2 className="display-sm">Ready to go ahead?</h2>
          <p className="mt-3 text-muted">Accept this quote to confirm your order. {hasDeposit ? `A ${depositLabel.toLowerCase()} is due to begin.` : ""}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button type="button" className={buttonClasses("primary", "lg")} onClick={() => setMode("accept")}>
              Accept Quote
            </button>
            <a href={contactHref} className={buttonClasses("secondary", "lg")}>
              Ask a Question
            </a>
            <button type="button" className={buttonClasses("text", "md", "sm:ml-auto")} onClick={() => setMode("decline")}>
              Decline
            </button>
          </div>
        </>
      ) : null}
      {mode === "accept" ? (
        <AcceptForm
          action={accept}
          revision={revision}
          hasDeposit={hasDeposit}
          customerName={customerName}
          onBack={() => setMode("choose")}
          onDone={(order) => {
            setDone({ kind: "accepted", order });
            router.refresh();
          }}
        />
      ) : null}
      {mode === "decline" ? (
        <DeclineForm
          action={decline}
          revision={revision}
          onBack={() => setMode("choose")}
          onDone={() => {
            setDone({ kind: "declined" });
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function useFocusOnMount() {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}

function AcceptForm({
  action,
  revision,
  hasDeposit,
  customerName,
  onBack,
  onDone,
}: {
  action: (fd: FormData) => Promise<FormState>;
  revision: number;
  hasDeposit: boolean;
  customerName: string;
  onBack: () => void;
  onDone: (order?: string) => void;
}) {
  const opts = useMemo(() => ({ validate: validateAccept, onSuccess: (s: FormState) => onDone(s.status === "success" ? s.reference : undefined) }), [onDone]);
  const { state, pending, onSubmit, formRef, fieldErrors } = usePublicForm(action, opts);
  const headingRef = useFocusOnMount();
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-6" aria-labelledby="accept-heading">
      <h2 id="accept-heading" ref={headingRef} tabIndex={-1} className="display-sm focus:outline-none">
        Accept quote
      </h2>
      <FormErrorSummary message={state.status === "error" ? state.message : undefined} />
      <input type="hidden" name="revision" value={revision} />
      <TextField label="Type your full name to accept" name="name" autoComplete="name" required defaultValue={customerName} error={fieldErrors.name} maxLength={120} />
      <Check name="agreeTerms" label={ACCEPT_TERMS_LABEL} error={fieldErrors.agreeTerms} />
      <Check name="agreeDeposit" label={hasDeposit ? ACCEPT_DEPOSIT_LABEL : ACCEPT_NO_DEPOSIT_LABEL} error={fieldErrors.agreeDeposit} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <SubmitButton pending={pending} pendingLabel="Accepting…">
          Accept Quote
        </SubmitButton>
        <button type="button" className={buttonClasses("secondary", "lg")} onClick={onBack} disabled={pending}>
          Back
        </button>
      </div>
    </form>
  );
}

function DeclineForm({ action, revision, onBack, onDone }: { action: (fd: FormData) => Promise<FormState>; revision: number; onBack: () => void; onDone: () => void }) {
  const opts = useMemo(() => ({ validate: validateDecline, onSuccess: () => onDone() }), [onDone]);
  const { state, pending, onSubmit, formRef, fieldErrors } = usePublicForm(action, opts);
  const headingRef = useFocusOnMount();
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-6" aria-labelledby="decline-heading">
      <h2 id="decline-heading" ref={headingRef} tabIndex={-1} className="display-sm focus:outline-none">
        Decline quote
      </h2>
      <FormErrorSummary message={state.status === "error" ? state.message : undefined} />
      <input type="hidden" name="revision" value={revision} />
      <TextAreaField label="Anything we should know?" name="reason" rows={4} maxLength={1000} hint="Optional — it helps us improve." error={fieldErrors.reason} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Decline Quote
        </SubmitButton>
        <button type="button" className={buttonClasses("secondary", "lg")} onClick={onBack} disabled={pending}>
          Back
        </button>
      </div>
    </form>
  );
}

function Check({ name, label, error }: { name: string; label: string; error?: string }) {
  return (
    <div>
      <label className="flex cursor-pointer items-start gap-3 text-[0.98rem] leading-relaxed">
        <input type="checkbox" name={name} className="mt-1 h-5 w-5 shrink-0 accent-charcoal" aria-invalid={error ? true : undefined} aria-describedby={error ? `${name}-error` : undefined} />
        <span>{label}</span>
      </label>
      {error ? (
        <p id={`${name}-error`} className="mt-1.5 pl-8 text-sm font-medium text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
