import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { buildStorageKey, inspectImage, UploadError } from "@/lib/media/process";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES } from "@/lib/media/validate";
import { loadConfigurableProduct } from "@/lib/pricing/load";
import { priceConfiguration } from "@/lib/pricing/engine";
import { buildConfigurationSnapshot } from "@/lib/pricing/snapshot";
import { generateReference } from "@/lib/references";
import { getSettings } from "@/lib/settings";
import { getStorage } from "@/lib/storage";
import {
  describeSnapshot,
  notifyContactMessage,
  notifyCustomRequest,
  sendContactConfirmation,
  sendCustomRequestConfirmation,
} from "@/lib/email/notifications";
import { adminRecipient, sendTemplateEmail } from "@/lib/email/send";
import { adminLinks } from "@/lib/sales/links";
import { createQuoteRecord } from "@/lib/sales/quotes";
import type {
  ConfigurationQuoteInput,
  ContactInput,
  CustomRequestInput,
  GeneralQuoteInput,
} from "@/lib/validation/forms";

export class SubmissionError extends Error {
  constructor(
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

type AttachmentData = { storageKey: string; filename: string; mimeType: string; size: number; width: number; height: number };

/** Validate and store customer reference images privately. */
export async function storeAttachments(files: File[]): Promise<AttachmentData[]> {
  const real = files.filter((f) => f && typeof f === "object" && f.size > 0);
  if (real.length > ATTACHMENT_MAX_FILES) {
    throw new SubmissionError(`Please attach no more than ${ATTACHMENT_MAX_FILES} images.`, {
      attachments: `Up to ${ATTACHMENT_MAX_FILES} images.`,
    });
  }
  const inspected = [];
  for (const file of real) {
    try {
      inspected.push({ file, img: await inspectImage(file, ATTACHMENT_MAX_BYTES) });
    } catch (err) {
      if (err instanceof UploadError) throw new SubmissionError(err.message, { attachments: err.message });
      throw err;
    }
  }
  const storage = getStorage();
  const stored: AttachmentData[] = [];
  for (const { file, img } of inspected) {
    const key = buildStorageKey("private", file.name, img.extension);
    await storage.put(key, img.buffer, img.mimeType);
    stored.push({ storageKey: key, filename: file.name.slice(0, 200), mimeType: img.mimeType, size: img.buffer.length, width: img.width, height: img.height });
  }
  return stored;
}

async function cleanupAttachments(items: AttachmentData[]) {
  const storage = getStorage();
  await Promise.all(items.map((a) => storage.delete(a.storageKey).catch(() => undefined)));
}

/** Retry creation if a (very unlikely) reference collision occurs. */
export async function withUniqueReference<T>(prefix: "Q" | "C", create: (reference: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await create(generateReference(prefix));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  throw new Error("Could not generate a unique reference");
}

/** Emails for a new quote request: confirmation to the customer, notification to Wild Mountain. */
async function notifyQuoteRequested(quote: { id: string; number: string | null; customerId: string | null; name: string; email: string; phone: string | null; zipCode: string; notes: string | null }, summary: string) {
  const settings = await getSettings();
  const vars = {
    customerName: quote.name,
    quoteNumber: quote.number,
    summary,
    confirmationText: settings.quoteConfirmationText || "Thank you for your request. We review every request personally and will be in touch soon.",
    customerEmail: quote.email,
    customerPhone: quote.phone,
    zipCode: quote.zipCode,
    notes: quote.notes ? `Notes: ${quote.notes}` : null,
  };
  const links = { customerId: quote.customerId, quoteId: quote.id };
  await sendTemplateEmail({ template: "quote_request_received", to: quote.email, vars, links });
  await sendTemplateEmail({ template: "admin_new_quote_request", to: await adminRecipient(), vars, actionUrl: adminLinks.quote(quote.id), links, replyTo: quote.email });
}

/**
 * "Request a quote" for a configuration: re-price the selection from the
 * database (never trusting the browser), snapshot it (including any sale
 * active right now), and store it as a quote with a first draft revision.
 * Product quotes take no customer files (see createCustomRequest for
 * inspiration photos); staff can attach files to the quote in admin.
 */
export async function createConfigurationQuote(input: Omit<ConfigurationQuoteInput, "quantity" | "address"> & { quantity?: number; address?: string | null }) {
  const quantity = input.quantity ?? 1;
  const settings = await getSettings();
  if (!settings.quotesEnabled) throw new SubmissionError("Quote requests are temporarily unavailable. Please contact us directly.");

  const product = await loadConfigurableProduct({ id: input.productId });
  if (!product) throw new SubmissionError("This piece is no longer available. Please contact us about it directly.");

  const pricing = priceConfiguration(product, input.selection);
  if (!pricing.valid) {
    throw new SubmissionError("Please review your configuration.", pricing.errors);
  }
  const productRecord = await prisma.product.findUnique({ where: { id: product.id }, select: { showPrice: true } });
  const priceShown = settings.showPrices && Boolean(productRecord?.showPrice) && pricing.totalCents != null;
  const snapshot = buildConfigurationSnapshot(product, input.selection, pricing, { priceShownToCustomer: priceShown });

  const customDims = snapshot.options.find((o) => o.isCustom && o.customDetails)?.customDetails ?? null;
  const quote = await prisma.$transaction((tx) =>
    createQuoteRecord(tx, {
      source: "CONFIGURATOR",
      name: input.name,
      email: input.email,
      phone: input.phone,
      zipCode: input.zipCode,
      address: input.address ?? null,
      quantity,
      productId: product.id,
      productName: product.name,
      configuration: snapshot,
      estimatedTotalCents: pricing.totalCents == null ? null : pricing.totalCents * quantity,
      requestedDimensions: customDims,
      notes: input.notes,
      timeline: input.timeline,
    }),
  );
  await logActivity("quote.received", `Quote ${quote.number} from ${quote.name} — ${product.name}${quantity > 1 ? ` × ${quantity}` : ""}`, { entityType: "quote", entityId: quote.id });
  const summary = [
    ...describeSnapshot(snapshot, priceShown),
    ...(quantity > 1 ? [`Quantity: ${quantity}`] : []),
  ].join("\n");
  // Awaited so the emails are logged before we reply (sending never throws).
  await notifyQuoteRequested(quote, summary).catch((error) => logger.error("Quote request emails failed", { error }));
  return quote;
}

/** General quote request (no configurator). */
export async function createGeneralQuote(input: GeneralQuoteInput, files: File[] = []) {
  const settings = await getSettings();
  if (!settings.quotesEnabled) throw new SubmissionError("Quote requests are temporarily unavailable. Please contact us directly.");
  const attachments = await storeAttachments(files);
  try {
    const quote = await prisma.$transaction((tx) =>
      createQuoteRecord(tx, {
        source: "GENERAL",
        name: input.name,
        email: input.email,
        phone: input.phone,
        zipCode: input.zipCode,
        productName: input.interest,
        requestedDimensions: input.requestedDimensions,
        notes: input.notes,
        timeline: input.timeline,
        attachments,
      }),
    );
    await logActivity("quote.received", `Quote ${quote.number} from ${quote.name} — ${input.interest}`, { entityType: "quote", entityId: quote.id });
    const summary = [`Interested in: ${input.interest}`, ...(input.requestedDimensions ? [`Dimensions: ${input.requestedDimensions}`] : [])].join("\n");
    // Awaited so the emails are logged before we reply (sending never throws).
    await notifyQuoteRequested(quote, summary).catch((error) => logger.error("Quote request emails failed", { error }));
    return quote;
  } catch (err) {
    await cleanupAttachments(attachments);
    throw err;
  }
}

export async function createCustomRequest(input: CustomRequestInput, files: File[] = []) {
  const settings = await getSettings();
  if (!settings.customOrdersEnabled) throw new SubmissionError("Custom build requests are temporarily unavailable. Please contact us directly.");
  const attachments = await storeAttachments(files);
  try {
    const request = await withUniqueReference("C", (reference) =>
      prisma.customRequest.create({
        data: {
          reference,
          name: input.name,
          email: input.email,
          phone: input.phone,
          zipCode: input.zipCode,
          furnitureType: input.furnitureType,
          approximateDimensions: input.approximateDimensions,
          woodPreference: input.woodPreference,
          finishPreference: input.finishPreference,
          description: input.description,
          timeline: input.timeline,
          attachments: { create: attachments },
          statusEvents: { create: { toStatus: "NEW" } },
        },
      }),
    );
    await logActivity("custom_request.received", `Custom request ${request.reference} from ${request.name} — ${request.furnitureType}`, {
      entityType: "custom_request",
      entityId: request.id,
    });
    void notifyCustomRequest(request).catch((error) => logger.error("notifyCustomRequest failed", { error }));
    void sendCustomRequestConfirmation(request).catch((error) => logger.error("sendCustomRequestConfirmation failed", { error }));
    return request;
  } catch (err) {
    await cleanupAttachments(attachments);
    throw err;
  }
}

export async function createContactMessage(input: ContactInput) {
  const message = await prisma.contactMessage.create({
    data: { name: input.name, email: input.email, phone: input.phone, reason: input.reason, message: input.message },
  });
  await logActivity("message.received", `Message from ${message.name}`, { entityType: "message", entityId: message.id });
  void notifyContactMessage(message).catch((error) => logger.error("notifyContactMessage failed", { error }));
  void sendContactConfirmation(message).catch((error) => logger.error("sendContactConfirmation failed", { error }));
  return message;
}
