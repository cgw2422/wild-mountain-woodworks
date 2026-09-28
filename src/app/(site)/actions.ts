"use server";

import { logger } from "@/lib/logger";
import { checkPublicSubmission } from "@/lib/services/abuse";
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

async function guard(fd: FormData, key: string): Promise<FormState | null> {
  const verdict = await checkPublicSubmission(fd, key);
  // Bots get a generic success so they don't retry; nothing is stored.
  if (verdict === "bot") return { status: "success" };
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
  const blocked = await guard(fd, "quote");
  if (blocked) return blocked;
  const parsed = configurationQuoteSchema.safeParse(formDataToObject(fd));
  if (!parsed.success) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  try {
    const quote = await createConfigurationQuote(parsed.data, files(fd));
    return { status: "success", reference: quote.reference };
  } catch (err) {
    return handleError(err, "Configuration quote");
  }
}

export async function submitGeneralQuote(fd: FormData): Promise<FormState> {
  const blocked = await guard(fd, "quote");
  if (blocked) return blocked;
  const parsed = generalQuoteSchema.safeParse(formDataToObject(fd));
  if (!parsed.success) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  try {
    const quote = await createGeneralQuote(parsed.data, files(fd));
    return { status: "success", reference: quote.reference };
  } catch (err) {
    return handleError(err, "General quote");
  }
}

export async function submitCustomRequest(fd: FormData): Promise<FormState> {
  const blocked = await guard(fd, "custom");
  if (blocked) return blocked;
  const parsed = customRequestSchema.safeParse(formDataToObject(fd));
  if (!parsed.success) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  try {
    const request = await createCustomRequest(parsed.data, files(fd));
    return { status: "success", reference: request.reference };
  } catch (err) {
    return handleError(err, "Custom request");
  }
}

export async function submitContactMessage(fd: FormData): Promise<FormState> {
  const blocked = await guard(fd, "contact");
  if (blocked) return blocked;
  const parsed = contactSchema.safeParse(formDataToObject(fd));
  if (!parsed.success) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  try {
    await createContactMessage(parsed.data);
    return { status: "success" };
  } catch (err) {
    return handleError(err, "Contact message");
  }
}
