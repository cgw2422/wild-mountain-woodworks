"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clientRules } from "@/lib/validation/shared";
import type { FormState } from "@/lib/validation/shared";
import { ACCEPT_DEPOSIT_LABEL, ACCEPT_FINANCE_LABEL, ACCEPT_NO_DEPOSIT_LABEL, ACCEPT_TERMS_LABEL } from "@/lib/sales/acceptance";
import { formatCents } from "@/lib/money";
import { buttonClasses } from "@/components/ui/Button";
import { FormErrorSummary, SubmitButton, TextAreaField, TextField } from "@/components/forms/fields";
import { clientValidator, usePublicForm } from "@/components/forms/usePublicForm";

const validateAccept = clientValidator(clientRules.acceptQuote);
const validateDecline = clientValidator(clientRules.declineQuote);

type PaymentPath = "deposit" | "finance";

/**
 * Accept / decline / contact for the current quote revision. With online
 * payments on there are two ways to proceed, chosen before accepting:
 *  - the standard deposit (Stripe Checkout for the deposit only — Affirm and
 *    Klarna aren't offered there), or
 *  - financing the FULL purchase (Checkout for the whole total, where Affirm /
 *    Klarna may appear when eligible).
 * Accepting continues straight to the chosen secure payment. The server
 * decides every amount; the figures shown here are display only.
 */
export function QuoteResponse({
  revision,
  totalCents,
  depositCents,
  balanceCents,
  depositLabel,
  onlinePayments,
  financingAvailable = false,
  depositNote,
  financeNote,
  customerName,
  contactHref,
  accept,
  decline,
}: {
  revision: number;
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  depositLabel: string;
  onlinePayments: boolean;
  /** Offer "Finance full purchase" (Affirm/Klarna when eligible) as the second choice. */
  financingAvailable?: boolean;
  /** Ordinary payment methods note for the deposit choice (Settings → Payments). */
  depositNote?: React.ReactNode;
  /** Explanation for the full-purchase financing choice (no amounts or terms beyond the total). */
  financeNote?: React.ReactNode;
  customerName: string;
  contactHref: string;
  accept: (fd: FormData) => Promise<FormState>;
  decline: (fd: FormData) => Promise<FormState>;
}) {
  const [mode, setMode] = useState<"choose" | "accept" | "decline">("choose");
  const [path, setPath] = useState<PaymentPath>("deposit");
  const [done, setDone] = useState<{ kind: "accepted"; order?: string; redirecting: boolean; path: PaymentPath } | { kind: "declined" } | null>(null);
  const router = useRouter();
  const hasDeposit = depositCents > 0;
  const payNow = hasDeposit && onlinePayments;
  const canFinance = onlinePayments && financingAvailable && totalCents > 0;
  const acceptLabel = payNow ? `Accept Quote & Pay ${formatCents(depositCents)} Deposit` : "Accept Quote";
  const financeLabel = `Finance Full ${formatCents(totalCents)} Purchase`;
  const startAccept = (p: PaymentPath) => {
    setPath(p);
    setMode("accept");
  };
  const financing = path === "finance";

  if (done?.kind === "accepted") {
    return (
      <div role="status" className="border border-success bg-paper p-6 md:p-8">
        <h2 className="display-sm">{done.redirecting ? "Quote accepted — taking you to secure payment…" : "Thank you — your quote is accepted."}</h2>
        <p className="mt-3 text-muted">
          {done.order ? `Your order number is ${done.order}. ` : ""}
          {done.redirecting
            ? done.path === "finance"
              ? `You'll finance your full ${formatCents(totalCents)} purchase on Stripe's secure checkout page, where Affirm or Klarna are shown when eligible, then come straight back here.`
              : "You'll pay your deposit on Stripe's secure checkout page, then come straight back here."
            : hasDeposit
              ? "We've emailed you a confirmation with how to pay your deposit."
              : "We've emailed you a confirmation."}
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
          {canFinance ? (
            <>
              <p className="mt-3 text-muted">Accept this quote to confirm your order. Choose how you&apos;d like to proceed:</p>
              <p className="mt-5 flex items-baseline justify-between gap-4 border-y border-stone py-3 text-[0.98rem]">
                <span className="text-[0.74rem] font-semibold uppercase tracking-[0.14em] text-muted">Quote total</span>
                <span className="font-display text-2xl tabular-nums">{formatCents(totalCents)}</span>
              </p>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div role="group" aria-label="Pay the deposit" className="flex flex-col border border-charcoal p-5">
                  <button type="button" className={buttonClasses("primary", "lg")} onClick={() => startAccept("deposit")}>
                    {hasDeposit ? `Pay ${formatCents(depositCents)} Deposit` : "Accept Quote"}
                  </button>
                  <p className="mt-3 text-sm leading-relaxed text-charcoal">
                    {hasDeposit
                      ? `Pay the required deposit today. The remaining ${formatCents(balanceCents)} will be due later.`
                      : "Accept now — payment is due as stated in the terms."}
                  </p>
                  {hasDeposit && depositNote ? <div className="mt-2">{depositNote}</div> : null}
                </div>
                <div role="group" aria-label="Finance the full purchase" className="flex flex-col border border-stone p-5">
                  <button type="button" className={buttonClasses("secondary", "lg")} onClick={() => startAccept("finance")}>
                    {financeLabel}
                  </button>
                  {financeNote ? <div className="mt-3">{financeNote}</div> : null}
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="mt-3 text-muted">
                Accept this quote to confirm your order.{" "}
                {payNow ? "You'll pay the deposit securely right after accepting." : hasDeposit ? `A ${depositLabel.toLowerCase()} is due to begin.` : ""}
              </p>
              {hasDeposit ? <PaymentSummary totalCents={totalCents} depositCents={depositCents} balanceCents={balanceCents} /> : null}
              {payNow && depositNote ? <div className="mt-4 max-w-xl">{depositNote}</div> : null}
            </>
          )}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {!canFinance ? (
              <button type="button" className={buttonClasses("primary", "lg")} onClick={() => startAccept("deposit")}>
                {acceptLabel}
              </button>
            ) : null}
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
          paymentPath={path}
          confirmLabel={financing ? ACCEPT_FINANCE_LABEL : hasDeposit ? ACCEPT_DEPOSIT_LABEL : ACCEPT_NO_DEPOSIT_LABEL}
          submitLabel={financing ? "Accept & Continue to Financing" : payNow ? `Accept & Pay ${formatCents(depositCents)} Deposit` : "Accept Quote"}
          summary={
            financing ? (
              <>
                <FinanceSummary totalCents={totalCents} />
                {financeNote ? <div className="mt-4 max-w-xl">{financeNote}</div> : null}
              </>
            ) : hasDeposit ? (
              <>
                <PaymentSummary totalCents={totalCents} depositCents={depositCents} balanceCents={balanceCents} />
                {payNow && depositNote ? <div className="mt-4 max-w-xl">{depositNote}</div> : null}
              </>
            ) : null
          }
          customerName={customerName}
          onBack={() => setMode("choose")}
          onDone={(order, redirect) => {
            setDone({ kind: "accepted", order, redirecting: Boolean(redirect && (payNow || financing) && !/^\/order\/[^/]+$/.test(redirect)), path });
            // The server returns where to go next: the deposit payment page
            // (which opens Stripe Checkout) or the new order page.
            if (redirect && /^\/(?![/\\])/.test(redirect)) window.location.assign(redirect);
            else router.refresh();
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

function PaymentSummary({ totalCents, depositCents, balanceCents }: { totalCents: number; depositCents: number; balanceCents: number }) {
  return (
    <dl className="mt-5 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-2 border-y border-stone py-4 text-[0.98rem]">
      <dt className="text-muted">Quote total</dt>
      <dd className="text-right tabular-nums">{formatCents(totalCents)}</dd>
      <dt className="font-semibold">Deposit due today</dt>
      <dd className="text-right font-semibold tabular-nums">{formatCents(depositCents)}</dd>
      <dt className="text-muted">Remaining balance</dt>
      <dd className="text-right tabular-nums">{formatCents(balanceCents)}</dd>
    </dl>
  );
}

/** Financing the whole order: Stripe Checkout is for the full total; nothing is left owed to the shop once paid. */
function FinanceSummary({ totalCents }: { totalCents: number }) {
  return (
    <dl className="mt-5 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-2 border-y border-stone py-4 text-[0.98rem]">
      <dt className="text-muted">Quote total</dt>
      <dd className="text-right tabular-nums">{formatCents(totalCents)}</dd>
      <dt className="font-semibold">Financed at checkout</dt>
      <dd className="text-right font-semibold tabular-nums">{formatCents(totalCents)}</dd>
      <dt className="text-muted">Owed to Wild Mountain Woodworks after approval</dt>
      <dd className="text-right tabular-nums">{formatCents(0, { showZeroCents: true })}</dd>
    </dl>
  );
}

function AcceptForm({
  action,
  revision,
  paymentPath,
  confirmLabel,
  submitLabel,
  summary,
  customerName,
  onBack,
  onDone,
}: {
  action: (fd: FormData) => Promise<FormState>;
  revision: number;
  paymentPath: PaymentPath;
  confirmLabel: string;
  submitLabel: string;
  summary: React.ReactNode;
  customerName: string;
  onBack: () => void;
  onDone: (order?: string, redirect?: string) => void;
}) {
  const opts = useMemo(
    () => ({ validate: validateAccept, onSuccess: (s: FormState) => (s.status === "success" ? onDone(s.reference, s.redirect) : onDone()) }),
    [onDone],
  );
  const { state, pending, onSubmit, formRef, fieldErrors } = usePublicForm(action, opts);
  const headingRef = useFocusOnMount();
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-6" aria-labelledby="accept-heading">
      <h2 id="accept-heading" ref={headingRef} tabIndex={-1} className="display-sm focus:outline-none">
        Accept quote
      </h2>
      <FormErrorSummary message={state.status === "error" ? state.message : undefined} />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="paymentPath" value={paymentPath} />
      <TextField label="Type your full name to accept" name="name" autoComplete="name" required defaultValue={customerName} error={fieldErrors.name} maxLength={120} />
      <Check name="agreeTerms" label={ACCEPT_TERMS_LABEL} error={fieldErrors.agreeTerms} />
      <Check name="agreeDeposit" label={confirmLabel} error={fieldErrors.agreeDeposit} />
      {summary}
      <div className="flex flex-col gap-3 sm:flex-row">
        <SubmitButton pending={pending} pendingLabel="Accepting…">
          {submitLabel}
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
