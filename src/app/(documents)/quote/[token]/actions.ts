"use server";

import { headers } from "next/headers";
import { clientIpFromHeaders } from "@/lib/auth/client-ip";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { SalesError } from "@/lib/sales/errors";
import { acceptQuote, declineQuote } from "@/lib/sales/quotes";
import { isTokenShape } from "@/lib/sales/tokens";
import { acceptQuoteSchema, declineQuoteSchema, fieldErrorsFrom, formDataToObject, type FormState } from "@/lib/validation/forms";

/*
 * Customer responses on /quote/[token]. The token (from the URL) is the only
 * credential; everything else — which revision, the price, the deposit — is
 * re-read on the server. Rate limited per IP.
 */

async function requestMeta() {
  const h = await headers();
  return { ip: clientIpFromHeaders(h), userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

const INVALID: FormState = { status: "error", message: "This quote link is not valid." };
const LIMITED: FormState = { status: "error", message: "Too many attempts. Please wait a few minutes and try again, or contact us." };

function failure(err: unknown, context: string): FormState {
  if (err instanceof SalesError) return { status: "error", message: err.message, fieldErrors: err.fieldErrors };
  logger.error(`${context} failed`, { error: err });
  return { status: "error", message: "Something went wrong on our side. Please try again in a moment, or contact us." };
}

export async function acceptQuoteAction(token: string, fd: FormData): Promise<FormState> {
  if (!isTokenShape(token)) return INVALID;
  const parsed = acceptQuoteSchema.safeParse(formDataToObject(fd));
  if (!parsed.success) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const meta = await requestMeta();
  if (!(await rateLimit(`quote-response:${meta.ip}`, 10, 600)).allowed) return LIMITED;
  try {
    const order = await acceptQuote(token, { revisionNumber: parsed.data.revision, name: parsed.data.name, agreeTerms: true, agreeDeposit: true }, meta);
    return { status: "success", reference: order.number };
  } catch (err) {
    return failure(err, "Quote acceptance");
  }
}

export async function declineQuoteAction(token: string, fd: FormData): Promise<FormState> {
  if (!isTokenShape(token)) return INVALID;
  const parsed = declineQuoteSchema.safeParse(formDataToObject(fd));
  if (!parsed.success) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const meta = await requestMeta();
  if (!(await rateLimit(`quote-response:${meta.ip}`, 10, 600)).allowed) return LIMITED;
  try {
    await declineQuote(token, { revisionNumber: parsed.data.revision, reason: parsed.data.reason }, meta);
    return { status: "success" };
  } catch (err) {
    return failure(err, "Quote decline");
  }
}
