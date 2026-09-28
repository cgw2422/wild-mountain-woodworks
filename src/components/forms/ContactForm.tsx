"use client";

import { useEffect, useRef } from "react";
import { submitContactMessage } from "@/app/(site)/actions";
import { CONTACT_REASONS, contactSchema } from "@/lib/validation/forms";
import { clientValidator, usePublicForm } from "./usePublicForm";

const FORM_OPTS = { validate: clientValidator(contactSchema) };
import { AntiSpamFields, FormErrorSummary, SelectField, SubmitButton, TextAreaField, TextField } from "./fields";

export function ContactForm({ defaultReason }: { defaultReason?: string }) {
  const { state, pending, onSubmit, formRef, fieldErrors } = usePublicForm(submitContactMessage, FORM_OPTS);
  const successRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "success") successRef.current?.focus();
  }, [state.status]);

  if (state.status === "success") {
    return (
      <div ref={successRef} tabIndex={-1} role="status" className="border border-charcoal bg-paper p-8 focus:outline-none md:p-10">
        <p className="eyebrow text-bronze-text">Message sent</p>
        <h2 className="display-md mt-4">Thank you for reaching out.</h2>
        <p className="lede mt-4 text-muted">We&apos;ve received your message and will reply as soon as we can.</p>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="relative space-y-6" aria-label="Contact form">
      <FormErrorSummary message={state.status === "error" ? state.message : undefined} />
      <AntiSpamFields />
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField label="Name" name="name" autoComplete="name" required error={fieldErrors.name} maxLength={120} />
        <TextField label="Email" name="email" type="email" autoComplete="email" required error={fieldErrors.email} maxLength={254} />
        <TextField label="Phone" name="phone" type="tel" autoComplete="tel" error={fieldErrors.phone} maxLength={30} />
        <SelectField label="Reason" name="reason" required options={CONTACT_REASONS} defaultValue={defaultReason ?? ""} error={fieldErrors.reason} />
      </div>
      <TextAreaField label="Message" name="message" required rows={7} maxLength={5000} error={fieldErrors.message} />
      <SubmitButton pending={pending}>Send Message</SubmitButton>
    </form>
  );
}
