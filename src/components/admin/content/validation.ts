import { z } from "zod";

/**
 * Shared Zod helpers for the content admin (homepage, pages, portfolio,
 * FAQs, settings). Pure — safe to import from server actions and clients.
 */

/** Trimmed text; empty becomes null. */
export const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const reqText = (max: number, message = "This field is required.") =>
  z.string().trim().min(1, message).max(max, `Keep this under ${max} characters.`);

/**
 * A link destination: an on-site path ("/custom-furniture", "#form"), a full
 * http(s) URL, or a mailto:/tel: link. Blocks javascript: and similar.
 */
export function isSafeHref(v: string) {
  if (/^\/(?!\/)/.test(v) || v.startsWith("#")) return !/\s/.test(v);
  if (/^(mailto|tel):/i.test(v)) return v.length > 5;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export const optHref = z
  .string()
  .trim()
  .max(500, "Keep this under 500 characters.")
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v == null || isSafeHref(v), "Use a page path like /custom-furniture or a full URL starting with https://");

export const optUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => {
    if (v == null) return true;
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "Enter a full web address starting with https://");

export const optEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v == null || z.email().safeParse(v).success, "Enter a valid email address.");

/** A media id from an ImageField hidden input (empty = no image). */
export const optMediaId = z
  .string()
  .trim()
  .max(40)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/** Search engines truncate around these lengths; counters warn past them. */
export const SEO_TITLE_RECOMMENDED = 60;
export const SEO_DESCRIPTION_RECOMMENDED = 155;
/** Hard limits enforced on save. */
export const SEO_TITLE_MAX = 120;
export const SEO_DESCRIPTION_MAX = 320;
