import { z } from "zod";
import { CONTACT_REASONS, TIMELINE_OPTIONS, formDataToObject, type FormState } from "./shared";

export { CONTACT_REASONS, TIMELINE_OPTIONS, formDataToObject };
export type { FormState };

/**
 * Public form schemas. Imported by client components for convenience
 * validation and by server actions/services for authoritative validation.
 */

const trimmed = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`);
const optionalText = (max: number) =>
  trimmed(max)
    .optional()
    .transform((v) => (v ? v : null));

export const nameSchema = trimmed(120).min(2, "Please enter your name.");
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email("Please enter a valid email address."));
export const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v == null || /^[+()\d\s.\-x]{7,30}$/i.test(v), "Please enter a valid phone number.");
export const zipSchema = z
  .string()
  .trim()
  .regex(/^\d{5}(-\d{4})?$/, "Please enter a 5-digit ZIP code.");

const timelineSchema = z
  .string()
  .trim()
  .max(60)
  .optional()
  .transform((v) => (v ? v : null));

const selectionSchema = z.object({
  options: z.record(z.string().max(40), z.string().max(40)).default({}),
  addOns: z.record(z.string().max(40), z.number().int().min(0).max(99)).default({}),
  customDetails: z.record(z.string().max(40), z.string().trim().max(500)).default({}),
});

export const quantitySchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : "1"))
  .pipe(z.string().regex(/^\d{1,2}$/, "Enter a quantity from 1 to 20."))
  .transform(Number)
  .pipe(z.number().int().min(1, "Enter a quantity from 1 to 20.").max(20, "Enter a quantity from 1 to 20."));

export const configurationQuoteSchema = z.object({
  productId: z.string().min(1).max(40),
  selection: z
    .string()
    .max(20000)
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid configuration." });
        return z.NEVER;
      }
    })
    .pipe(selectionSchema),
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  zipCode: zipSchema,
  quantity: quantitySchema,
  address: optionalText(300),
  timeline: timelineSchema,
  notes: optionalText(4000),
});
export type ConfigurationQuoteInput = z.infer<typeof configurationQuoteSchema>;

export const generalQuoteSchema = z.object({
  interest: trimmed(160).min(2, "Tell us which piece you're interested in."),
  requestedDimensions: optionalText(300),
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  zipCode: zipSchema,
  timeline: timelineSchema,
  notes: optionalText(4000),
});
export type GeneralQuoteInput = z.infer<typeof generalQuoteSchema>;

export const customRequestSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  zipCode: zipSchema,
  furnitureType: trimmed(120).min(2, "What kind of piece are you thinking of?"),
  approximateDimensions: optionalText(300),
  woodPreference: optionalText(120),
  finishPreference: optionalText(120),
  description: trimmed(5000).min(10, "Please describe the piece in a sentence or two."),
  timeline: timelineSchema,
});
export type CustomRequestInput = z.infer<typeof customRequestSchema>;

export const contactSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  reason: z.enum(["PRODUCT_QUESTION", "CUSTOM_FURNITURE", "EXISTING_QUOTE", "DELIVERY_QUESTION", "OTHER"], {
    error: "Please choose a reason.",
  }),
  message: trimmed(5000).min(10, "Please include a short message."),
});
export type ContactInput = z.infer<typeof contactSchema>;

/** Customer accepts a quote on /quote/[token]. */
export const acceptQuoteSchema = z.object({
  revision: z.string().regex(/^\d{1,4}$/, "Invalid quote version.").transform(Number),
  name: nameSchema,
  agreeTerms: z.literal("on", { error: "Please confirm this statement." }),
  agreeDeposit: z.literal("on", { error: "Please confirm this statement." }),
  /** How the customer wants to proceed: the standard deposit, or financing the full purchase. */
  paymentPath: z.enum(["deposit", "finance"]).default("deposit"),
});
export type AcceptQuoteInput = z.infer<typeof acceptQuoteSchema>;

/** Customer declines a quote (reason optional). */
export const declineQuoteSchema = z.object({
  revision: z.string().regex(/^\d{1,4}$/, "Invalid quote version.").transform(Number),
  reason: optionalText(1000),
});

export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
