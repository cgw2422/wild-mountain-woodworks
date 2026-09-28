import { z } from "zod";
import { parseDollarsToCents } from "@/lib/money";

/**
 * Shared Zod building blocks for the admin catalog (products, categories,
 * options, add-ons). Form values arrive as strings.
 */

export const requiredText = (max: number, message = "This field is required.") =>
  z.string().trim().min(1, message).max(max, `Keep this under ${max} characters.`);

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

/** Dollar amount entered as text → integer cents (or null when blank). */
export const moneyText = (opts: { required?: boolean; allowNegative?: boolean } = {}) =>
  z.string().transform((raw, ctx) => {
    const cents = parseDollarsToCents(raw);
    if (cents === null) {
      if (opts.required) ctx.addIssue({ code: "custom", message: "Enter an amount." });
      return null;
    }
    if (Number.isNaN(cents)) {
      ctx.addIssue({ code: "custom", message: "Enter an amount like 1295 or 1,295.50." });
      return null;
    }
    if (!opts.allowNegative && cents < 0) {
      ctx.addIssue({ code: "custom", message: "The amount can't be negative." });
      return null;
    }
    if (Math.abs(cents) > 100_000_000) {
      ctx.addIssue({ code: "custom", message: "That amount is too large." });
      return null;
    }
    return cents;
  });

/** Whole number from a text field (blank → null). */
export const intText = (opts: { min?: number; max?: number } = {}) =>
  z.string().transform((raw, ctx) => {
    const v = raw.trim();
    if (v === "") return null;
    if (!/^-?\d+$/.test(v)) {
      ctx.addIssue({ code: "custom", message: "Enter a whole number." });
      return null;
    }
    const n = Number(v);
    if (opts.min != null && n < opts.min) ctx.addIssue({ code: "custom", message: `Must be ${opts.min} or more.` });
    if (opts.max != null && n > opts.max) ctx.addIssue({ code: "custom", message: `Must be ${opts.max} or less.` });
    return n;
  });

/** Internal path ("/custom-furniture") or absolute http(s) URL; blank → null. */
export const linkUrlText = z
  .string()
  .trim()
  .max(300)
  .transform((v, ctx) => {
    if (v === "") return null;
    if (/^\/(?!\/)[^\s]*$/.test(v)) return v;
    try {
      const u = new URL(v);
      if (u.protocol === "https:" || u.protocol === "http:") return v;
    } catch {
      // fall through
    }
    ctx.addIssue({ code: "custom", message: "Use a site path like /custom-furniture or a full https:// URL." });
    return null;
  });

export const hexColorText = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) {
      ctx.addIssue({ code: "custom", message: "Use a 6-digit hex color like #6B4F36." });
      return null;
    }
    return v.toUpperCase();
  });

export const idList = z.array(z.string().min(1).max(64)).max(1000);
