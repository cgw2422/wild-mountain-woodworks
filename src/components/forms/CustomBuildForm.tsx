"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { submitCustomRequest } from "@/app/(site)/actions";
import { TIMELINE_OPTIONS, customRequestSchema } from "@/lib/validation/forms";
import { clientValidator, usePublicForm } from "./usePublicForm";

const validate = clientValidator(customRequestSchema);
import { AntiSpamFields, FormErrorSummary, ReferenceImagesField, SelectField, SubmitButton, TextAreaField, TextField } from "./fields";

export function CustomBuildForm({
  furnitureTypes,
  woods,
  finishes,
}: {
  furnitureTypes: string[];
  woods: string[];
  finishes: string[];
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
  const { state, pending, onSubmit, formRef, fieldErrors } = usePublicForm(submitCustomRequest, opts);
  const successRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "success") successRef.current?.focus();
  }, [state.status]);

  if (state.status === "success") {
    return (
      <div ref={successRef} tabIndex={-1} role="status" className="border border-charcoal bg-paper p-8 focus:outline-none md:p-10">
        <p className="eyebrow text-bronze-text">Request received</p>
        <h3 className="display-md mt-4">Thank you — we&apos;ll be in touch.</h3>
        <p className="lede mt-4 text-muted">We&apos;ve received the details of your custom piece and will follow up personally to talk through next steps.</p>
        {state.reference ? (
          <p className="mt-6 text-sm">
            Your reference number: <strong className="font-semibold tracking-wide">{state.reference}</strong>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="relative space-y-6" aria-label="Custom build request">
      <FormErrorSummary message={state.status === "error" ? state.message : undefined} />
      <AntiSpamFields />
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField label="Name" name="name" autoComplete="name" required error={fieldErrors.name} maxLength={120} />
        <TextField label="Email" name="email" type="email" autoComplete="email" required error={fieldErrors.email} maxLength={254} />
        <TextField label="Phone" name="phone" type="tel" autoComplete="tel" error={fieldErrors.phone} maxLength={30} />
        <TextField label="ZIP code" name="zipCode" inputMode="numeric" autoComplete="postal-code" required error={fieldErrors.zipCode} maxLength={10} />
      </div>
      <TextField
        label="Furniture type"
        name="furnitureType"
        required
        list="custom-furniture-types"
        placeholder="e.g. Dining table, bench, console"
        error={fieldErrors.furnitureType}
        maxLength={120}
      />
      <datalist id="custom-furniture-types">
        {furnitureTypes.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <TextField
        label="Approximate dimensions"
        name="approximateDimensions"
        placeholder="e.g. about 90 × 40 in, seats 10"
        error={fieldErrors.approximateDimensions}
        maxLength={300}
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField label="Wood preference" name="woodPreference" list="custom-woods" placeholder="Not sure yet is fine" error={fieldErrors.woodPreference} maxLength={120} />
        <TextField label="Finish preference" name="finishPreference" list="custom-finishes" placeholder="If you know it" error={fieldErrors.finishPreference} maxLength={120} />
      </div>
      <datalist id="custom-woods">
        {woods.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="custom-finishes">
        {finishes.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <TextAreaField
        label="Tell us about your piece"
        name="description"
        required
        rows={6}
        maxLength={5000}
        placeholder="How you'll use it, the room it's for, the style you like, anything that matters to you."
        error={fieldErrors.description}
      />
      <SelectField label="Desired completion" name="timeline" options={TIMELINE_OPTIONS.map((t) => ({ value: t, label: t }))} error={fieldErrors.timeline} />
      <ReferenceImagesField files={files} onChange={setFiles} error={fieldErrors.attachments} />
      <div className="flex flex-col gap-4 pt-2 sm:flex-row sm:items-center">
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send Custom Build Request
        </SubmitButton>
        <p className="text-xs text-muted">No obligation. We&apos;ll only use your details to respond.</p>
      </div>
    </form>
  );
}
