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
  notifyContactMessage,
  notifyCustomRequest,
  notifyNewQuote,
  sendContactConfirmation,
  sendCustomRequestConfirmation,
  sendQuoteConfirmation,
} from "@/lib/email/notifications";
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

/**
 * "Request this configuration": re-price the selection from the database
 * (never trusting the browser), snapshot it, and store the quote request.
 */
export async function createConfigurationQuote(input: ConfigurationQuoteInput, files: File[] = []) {
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
  const attachments = await storeAttachments(files);
  try {
    const quote = await withUniqueReference("Q", (reference) =>
      prisma.quoteRequest.create({
        data: {
          reference,
          source: "CONFIGURATOR",
          name: input.name,
          email: input.email,
          phone: input.phone,
          zipCode: input.zipCode,
          productId: product.id,
          productName: product.name,
          configuration: snapshot as unknown as Prisma.InputJsonValue,
          estimatedTotalCents: pricing.totalCents,
          requestedDimensions: customDims,
          notes: input.notes,
          timeline: input.timeline,
          attachments: { create: attachments },
          statusEvents: { create: { toStatus: "NEW" } },
        },
      }),
    );
    await logActivity("quote.received", `Quote ${quote.reference} from ${quote.name} — ${product.name}`, { entityType: "quote", entityId: quote.id });
    void notifyNewQuote({ ...quote, snapshot }).catch((error) => logger.error("notifyNewQuote failed", { error }));
    void sendQuoteConfirmation({ ...quote, snapshot }).catch((error) => logger.error("sendQuoteConfirmation failed", { error }));
    return quote;
  } catch (err) {
    await cleanupAttachments(attachments);
    throw err;
  }
}

/** General quote request (no configurator). */
export async function createGeneralQuote(input: GeneralQuoteInput, files: File[] = []) {
  const settings = await getSettings();
  if (!settings.quotesEnabled) throw new SubmissionError("Quote requests are temporarily unavailable. Please contact us directly.");
  const attachments = await storeAttachments(files);
  try {
    const quote = await withUniqueReference("Q", (reference) =>
      prisma.quoteRequest.create({
        data: {
          reference,
          source: "GENERAL",
          name: input.name,
          email: input.email,
          phone: input.phone,
          zipCode: input.zipCode,
          productName: input.interest,
          requestedDimensions: input.requestedDimensions,
          notes: input.notes,
          timeline: input.timeline,
          attachments: { create: attachments },
          statusEvents: { create: { toStatus: "NEW" } },
        },
      }),
    );
    await logActivity("quote.received", `Quote ${quote.reference} from ${quote.name} — ${input.interest}`, { entityType: "quote", entityId: quote.id });
    void notifyNewQuote({ ...quote, snapshot: null }).catch((error) => logger.error("notifyNewQuote failed", { error }));
    void sendQuoteConfirmation({ ...quote, snapshot: null }).catch((error) => logger.error("sendQuoteConfirmation failed", { error }));
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
