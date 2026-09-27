import { z } from "zod";

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

export const TIMELINE_OPTIONS = [
  "As soon as possible",
  "Within 1–3 months",
  "Within 3–6 months",
  "More than 6 months out",
  "Flexible",
] as const;

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

export const CONTACT_REASONS = [
  { value: "PRODUCT_QUESTION", label: "Product question" },
  { value: "CUSTOM_FURNITURE", label: "Custom furniture" },
  { value: "EXISTING_QUOTE", label: "Existing quote" },
  { value: "DELIVERY_QUESTION", label: "Delivery question" },
  { value: "OTHER", label: "Other" },
] as const;

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

/** Standard result returned by public form server actions. */
export type FormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> }
  | { status: "success"; reference?: string; message?: string };

export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Collect a FormData into a plain object of strings (files excluded). */
export function formDataToObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
