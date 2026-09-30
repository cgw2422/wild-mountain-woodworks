"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { AdminError, adminAction, fd } from "@/lib/admin/action";
import { revalidateSite } from "@/lib/revalidate";
import type { Prisma } from "@/generated/prisma/client";
import { parseDollarsToCents } from "@/lib/money";
import { parsePercentToBps } from "@/lib/sales/totals";
import {
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  optEmail,
  optMediaId,
  optText,
  optUrl,
  reqText,
} from "@/components/admin/content/validation";

const phone = z
  .string()
  .trim()
  .max(30)
  .transform((v) => (v ? v : null))
  .refine((v) => v == null || /^[+()\d\s.\-x]{7,30}$/i.test(v), "Enter a valid phone number.");

const SECTIONS = {
  business: {
    label: "business details",
    schema: z.object({
      businessName: reqText(120, "Enter the business name."),
      tagline: z.string().trim().max(160),
      brandStatement: optText(600),
      email: optEmail,
      phone,
      locationText: optText(120),
      serviceAreaText: optText(300),
      addressLocality: optText(120),
      addressRegion: optText(60),
      notificationEmail: optEmail,
    }),
  },
  social: {
    label: "social links",
    schema: z.object({ instagramUrl: optUrl, facebookUrl: optUrl, pinterestUrl: optUrl, houzzUrl: optUrl }),
  },
  seo: {
    label: "SEO defaults",
    schema: z.object({ defaultSeoTitle: optText(SEO_TITLE_MAX), defaultSeoDescription: optText(SEO_DESCRIPTION_MAX), defaultOgImageId: optMediaId }),
  },
  quotes: {
    label: "pricing & quote text",
    schema: z.object({ defaultLeadTime: optText(160), priceDisclaimer: optText(400), quoteConfirmationText: optText(1500) }),
  },
  features: {
    label: "feature flags",
    schema: z.object({ showPrices: z.boolean(), quotesEnabled: z.boolean(), customOrdersEnabled: z.boolean(), stripeInvoicingEnabled: z.boolean(), taxEnabled: z.boolean() }),
  },
  sales: {
    label: "quote & invoice defaults",
    schema: z.object({
      quoteValidDays: z.coerce.number({ error: "Enter a number of days." }).int().min(1, "At least 1 day.").max(365),
      invoiceDueDays: z.coerce.number({ error: "Enter a number of days." }).int().min(0).max(365),
      quoteAlertDays: z.coerce.number({ error: "Enter a number of days." }).int().min(1).max(60),
      invoiceEmailMode: z.enum(["WILD_MOUNTAIN", "STRIPE"]),
      defaultDepositType: z.enum(["NONE", "PERCENTAGE", "FIXED_AMOUNT"]),
      defaultDepositPercent: z.string().trim().max(10),
      defaultDepositAmount: z.string().trim().max(20),
      defaultQuoteTerms: optText(20000),
      paymentInstructions: optText(2000),
    }),
  },
} as const;
type SettingsSection = keyof typeof SECTIONS;

const BOOLEAN_FIELDS = new Set(["showPrices", "quotesEnabled", "customOrdersEnabled", "stripeInvoicingEnabled", "taxEnabled"]);

/** Deposit defaults arrive as text ("50", "250.00"); store basis points / cents. */
function salesData(parsed: Record<string, unknown>): Record<string, unknown> {
  const { defaultDepositPercent, defaultDepositAmount, ...rest } = parsed as Record<string, string | number | null>;
  const bps = parsePercentToBps(String(defaultDepositPercent ?? ""));
  const cents = parseDollarsToCents(String(defaultDepositAmount ?? ""));
  if (rest.defaultDepositType === "PERCENTAGE" && (!Number.isFinite(bps) || bps <= 0 || bps > 10000)) {
    throw new AdminError("Enter a deposit percentage from 1 to 100.", { defaultDepositPercent: "Enter 1–100." });
  }
  if (rest.defaultDepositType === "FIXED_AMOUNT" && (cents == null || Number.isNaN(cents) || cents <= 0)) {
    throw new AdminError("Enter the default deposit amount.", { defaultDepositAmount: "Enter an amount." });
  }
  return {
    ...rest,
    ...(Number.isFinite(bps) && bps > 0 ? { defaultDepositPercentBps: bps } : {}),
    defaultDepositAmountCents: cents != null && !Number.isNaN(cents) && cents > 0 ? cents : null,
  };
}

export const saveSettings = adminAction(async (admin, section: SettingsSection, data: FormData) => {
  const def = SECTIONS[section];
  if (!def) throw new AdminError("Unknown settings section.");
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(def.schema.shape)) raw[key] = BOOLEAN_FIELDS.has(key) ? fd.bool(data, key) : fd.str(data, key);
  let parsed = def.schema.parse(raw) as Record<string, unknown>;
  if (section === "sales") parsed = salesData(parsed);
  if (section === "seo" && parsed.defaultOgImageId) {
    const exists = await prisma.media.findUnique({ where: { id: parsed.defaultOgImageId as string }, select: { id: true } });
    if (!exists) throw new AdminError("The selected image was deleted. Please choose another.");
  }
  const before = await prisma.siteSetting.findUnique({ where: { id: "default" }, select: { stripeInvoicingEnabled: true, taxEnabled: true } });
  await prisma.siteSetting.upsert({
    where: { id: "default" },
    update: parsed as Prisma.SiteSettingUpdateInput,
    create: { id: "default", ...(parsed as Prisma.SiteSettingUncheckedCreateInput) },
  });
  await logActivity("settings.updated", `${admin.name} updated ${def.label}`, { actorId: admin.id, entityType: "settings" });
  // Payment-related switches get their own audit entries.
  for (const [key, label] of [
    ["stripeInvoicingEnabled", "Stripe invoicing"],
    ["taxEnabled", "Tax"],
  ] as const) {
    if (key in parsed && (before?.[key] ?? false) !== parsed[key]) {
      await logActivity("settings.commerce_changed", `${admin.name} turned ${label} ${parsed[key] ? "ON" : "OFF"}`, { actorId: admin.id, entityType: "settings", entityId: key });
    }
  }
  revalidateSite();
  return { ok: true, message: `Saved ${def.label} — live on the site now.` };
});
