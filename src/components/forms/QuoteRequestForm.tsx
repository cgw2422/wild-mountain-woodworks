"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { submitGeneralQuote } from "@/app/(site)/actions";
import { TIMELINE_OPTIONS, generalQuoteSchema } from "@/lib/validation/forms";
import { clientValidator, usePublicForm } from "./usePublicForm";

const validate = clientValidator(generalQuoteSchema);
import { AntiSpamFields, FormErrorSummary, ReferenceImagesField, SelectField, SubmitButton, TextAreaField, TextField } from "./fields";

export function QuoteRequestForm({
  defaultInterest,
  suggestions,
  confirmation,
}: {
  defaultInterest?: string;
  suggestions: string[];
  confirmation: { heading: string | null; body: string | null };
}) {
  const [files, setFiles] = useState<File[]>([]);
  const opts = useMemo(
    () => ({
      prepare: (fd: FormData) => {
        fd.delete("attachments");
        files.forEach((f) => fd.append("attachments", f));
      },
      validate,
    }),
    [files],
  );
  const { state, pending, onSubmit, formRef, fieldErrors } = usePublicForm(submitGeneralQuote, opts);
  const successRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "success") successRef.current?.focus();
  }, [state.status]);

  if (state.status === "success") {
    return (
      <div ref={successRef} tabIndex={-1} role="status" className="border border-charcoal bg-paper p-8 focus:outline-none md:p-10">
        <p className="eyebrow text-bronze-text">Request received</p>
        <h2 className="display-md mt-4">{confirmation.heading || "Thank you — your request is in."}</h2>
        <p className="lede mt-4 text-muted">{confirmation.body || "We've received your request and will be in touch soon."}</p>
        {state.reference ? (
          <p className="mt-6 text-sm">
            Your reference number: <strong className="font-semibold tracking-wide">{state.reference}</strong>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="relative space-y-6" aria-label="Quote request">
      <FormErrorSummary message={state.status === "error" ? state.message : undefined} />
      <AntiSpamFields />
      <TextField
        label="What are you interested in?"
        name="interest"
        required
        list="quote-interest"
        defaultValue={defaultInterest}
        placeholder="e.g. The Ridge Dining Table, or a walnut bench"
        error={fieldErrors.interest}
        maxLength={160}
      />
      <datalist id="quote-interest">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <TextField label="Dimensions" name="requestedDimensions" placeholder="If you know them" error={fieldErrors.requestedDimensions} maxLength={300} />
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField label="Name" name="name" autoComplete="name" required error={fieldErrors.name} maxLength={120} />
        <TextField label="Email" name="email" type="email" autoComplete="email" required error={fieldErrors.email} maxLength={254} />
        <TextField label="Phone" name="phone" type="tel" autoComplete="tel" error={fieldErrors.phone} maxLength={30} />
        <TextField label="ZIP code" name="zipCode" inputMode="numeric" autoComplete="postal-code" required error={fieldErrors.zipCode} maxLength={10} />
      </div>
      <SelectField label="Desired timeline" name="timeline" options={TIMELINE_OPTIONS.map((t) => ({ value: t, label: t }))} error={fieldErrors.timeline} />
      <TextAreaField label="Details" name="notes" rows={5} maxLength={4000} placeholder="Wood, finish, size, style — anything that helps." error={fieldErrors.notes} />
      <ReferenceImagesField files={files} onChange={setFiles} error={fieldErrors.attachments} />
      <SubmitButton pending={pending}>Request a Quote</SubmitButton>
    </form>
  );
}
