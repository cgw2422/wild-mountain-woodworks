/**
 * Zod-free form constants and lightweight client-side validators.
 *
 * Client components import from here so the browser bundle stays small. The
 * server remains authoritative and validates with the Zod schemas in
 * ./forms.ts; tests/unit/client-validation.test.ts keeps both in agreement.
 */

export const TIMELINE_OPTIONS = [
  "As soon as possible",
  "Within 1–3 months",
  "Within 3–6 months",
  "More than 6 months out",
  "Flexible",
] as const;

export const CONTACT_REASONS = [
  { value: "PRODUCT_QUESTION", label: "Product question" },
  { value: "CUSTOM_FURNITURE", label: "Custom furniture" },
  { value: "EXISTING_QUOTE", label: "Existing quote" },
  { value: "DELIVERY_QUESTION", label: "Delivery question" },
  { value: "OTHER", label: "Other" },
] as const;

/** Standard result returned by public form server actions. */
export type FormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> }
  | { status: "success"; reference?: string; message?: string; /** Same-site path to continue to (e.g. deposit payment). */ redirect?: string };

/** Collect a FormData into a plain object of strings (files excluded). */
export function formDataToObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PHONE_PATTERN = /^[+()\d\s.\-x]{7,30}$/i;
export const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;

type Values = Record<string, string | undefined>;
type Rule = (v: string) => string | null;

const required = (msg: string, min = 1): Rule => (v) => (v.length < min ? msg : null);
const max = (n: number): Rule => (v) => (v.length > n ? `Keep this under ${n} characters.` : null);

function check(values: Values, rules: Record<string, Rule[]>): Record<string, string> | null {
  const errors: Record<string, string> = {};
  for (const [field, fieldRules] of Object.entries(rules)) {
    const v = (values[field] ?? "").trim();
    for (const rule of fieldRules) {
      const e = rule(v);
      if (e) {
        errors[field] = e;
        break;
      }
    }
  }
  return Object.keys(errors).length ? errors : null;
}

const person: Record<string, Rule[]> = {
  name: [max(120), required("Please enter your name.", 2)],
  email: [max(254), (v) => (EMAIL_PATTERN.test(v) ? null : "Please enter a valid email address.")],
  phone: [max(30), (v) => (v === "" || PHONE_PATTERN.test(v) ? null : "Please enter a valid phone number.")],
  zipCode: [(v) => (ZIP_PATTERN.test(v) ? null : "Please enter a 5-digit ZIP code.")],
};

export const clientRules = {
  contact: (v: Values) =>
    check(v, {
      name: person.name!,
      email: person.email!,
      phone: person.phone!,
      reason: [(x) => (CONTACT_REASONS.some((r) => r.value === x) ? null : "Please choose a reason.")],
      message: [max(5000), required("Please include a short message.", 10)],
    }),
  customRequest: (v: Values) =>
    check(v, {
      ...person,
      furnitureType: [max(120), required("What kind of piece are you thinking of?", 2)],
      approximateDimensions: [max(300)],
      woodPreference: [max(120)],
      finishPreference: [max(120)],
      description: [max(5000), required("Please describe the piece in a sentence or two.", 10)],
    }),
  generalQuote: (v: Values) =>
    check(v, {
      interest: [max(160), required("Tell us which piece you're interested in.", 2)],
      requestedDimensions: [max(300)],
      ...person,
      notes: [max(4000)],
    }),
  configurationQuote: (v: Values) =>
    check(v, {
      ...person,
      quantity: [(x) => (x === "" || (/^\d{1,2}$/.test(x) && Number(x) >= 1 && Number(x) <= 20) ? null : "Enter a quantity from 1 to 20.")],
      address: [max(300)],
      notes: [max(4000)],
    }),
  acceptQuote: (v: Values) =>
    check(v, {
      name: person.name!,
      agreeTerms: [(x) => (x === "on" ? null : "Please confirm this statement.")],
      agreeDeposit: [(x) => (x === "on" ? null : "Please confirm this statement.")],
    }),
  declineQuote: (v: Values) => check(v, { reason: [max(1000)] }),
};
