"use server";

import { logger } from "@/lib/logger";
import { checkPublicSubmission, isHoneypotTripped } from "@/lib/services/abuse";
import {
  SubmissionError,
  createConfigurationQuote,
  createContactMessage,
  createCustomRequest,
  createGeneralQuote,
} from "@/lib/services/submissions";
import {
  configurationQuoteSchema,
  contactSchema,
  customRequestSchema,
  fieldErrorsFrom,
  formDataToObject,
  generalQuoteSchema,
  type FormState,
} from "@/lib/validation/forms";

const RATE_LIMITED: FormState = {
  status: "error",
  message: "We've received several submissions from your connection in a short time. Please wait a few minutes and try again, or contact us directly.",
};
const GENERIC_FAILURE: FormState = {
  status: "error",
  message: "Something went wrong on our side and your request wasn't sent. Please try again in a moment.",
};

function files(fd: FormData, key = "attachments"): File[] {
  return fd.getAll(key).filter((v): v is File => typeof v === "object" && v !== null && "size" in v && (v as File).size > 0);
}

const TOO_FAST: FormState = {
  status: "error",
  message: "That was quick! Please take a moment to check your details, then send again.",
};

// Bots that fill the hidden honeypot get a generic success so they don't
// retry; nothing is stored.
const BOT_ACCEPTED: FormState = { status: "success" };

/** Runs after validation, so real visitors always see field errors first. */
async function guard(fd: FormData, key: string): Promise<FormState | null> {
  const verdict = await checkPublicSubmission(fd, key);
  if (verdict === "bot") return BOT_ACCEPTED;
  if (verdict === "too-fast") return TOO_FAST;
  if (verdict === "limited") return RATE_LIMITED;
  return null;
}

function handleError(err: unknown, context: string): FormState {
  if (err instanceof SubmissionError) return { status: "error", message: err.message, fieldErrors: err.fieldErrors };
  logger.error(`${context} failed`, { error: err });
  return GENERIC_FAILURE;
}

/** "Request This Configuration" from the product configurator. */
export async function submitConfigurationQuote(fd: FormData): Promise<FormState> {
  if (isHoneypotTripped(fd)) return BOT_ACCEPTED;
  const parsed = configurationQuoteSchema.safeParse(formDataToObject(fd));
  if (!parsed.success) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const blocked = await guard(fd, "quote");
  if (blocked) return blocked;
  try {
    const quote = await createConfigurationQuote(parsed.data, files(fd));
    return { status: "success", reference: quote.reference };
  } catch (err) {
    return handleError(err, "Configuration quote");
  }
}

export async function submitGeneralQuote(fd: FormData): Promise<FormState> {
  if (isHoneypotTripped(fd)) return BOT_ACCEPTED;
  const parsed = generalQuoteSchema.safeParse(formDataToObject(fd));
  if (!parsed.success) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const blocked = await guard(fd, "quote");
  if (blocked) return blocked;
  try {
    const quote = await createGeneralQuote(parsed.data, files(fd));
    return { status: "success", reference: quote.reference };
  } catch (err) {
    return handleError(err, "General quote");
  }
}

export async function submitCustomRequest(fd: FormData): Promise<FormState> {
  if (isHoneypotTripped(fd)) return BOT_ACCEPTED;
  const parsed = customRequestSchema.safeParse(formDataToObject(fd));
  if (!parsed.success) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const blocked = await guard(fd, "custom");
  if (blocked) return blocked;
  try {
    const request = await createCustomRequest(parsed.data, files(fd));
    return { status: "success", reference: request.reference };
  } catch (err) {
    return handleError(err, "Custom request");
  }
}

export async function submitContactMessage(fd: FormData): Promise<FormState> {
  if (isHoneypotTripped(fd)) return BOT_ACCEPTED;
  const parsed = contactSchema.safeParse(formDataToObject(fd));
  if (!parsed.success) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const blocked = await guard(fd, "contact");
  if (blocked) return blocked;
  try {
    await createContactMessage(parsed.data);
    return { status: "success" };
  } catch (err) {
    return handleError(err, "Contact message");
  }
}
