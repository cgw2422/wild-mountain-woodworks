"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { AdminError, adminAction, fd } from "@/lib/admin/action";
import { revalidateSite } from "@/lib/revalidate";
import type { Prisma } from "@/generated/prisma/client";
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
    schema: z.object({ showPrices: z.boolean(), quotesEnabled: z.boolean(), customOrdersEnabled: z.boolean(), ecommerceEnabled: z.boolean() }),
  },
} as const;
type SettingsSection = keyof typeof SECTIONS;

const BOOLEAN_FIELDS = new Set(["showPrices", "quotesEnabled", "customOrdersEnabled", "ecommerceEnabled"]);

export const saveSettings = adminAction(async (admin, section: SettingsSection, data: FormData) => {
  const def = SECTIONS[section];
  if (!def) throw new AdminError("Unknown settings section.");
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(def.schema.shape)) raw[key] = BOOLEAN_FIELDS.has(key) ? fd.bool(data, key) : fd.str(data, key);
  const parsed = def.schema.parse(raw) as Record<string, unknown>;
  if (section === "seo" && parsed.defaultOgImageId) {
    const exists = await prisma.media.findUnique({ where: { id: parsed.defaultOgImageId as string }, select: { id: true } });
    if (!exists) throw new AdminError("The selected image was deleted. Please choose another.");
  }
  await prisma.siteSetting.upsert({
    where: { id: "default" },
    update: parsed as Prisma.SiteSettingUpdateInput,
    create: { id: "default", ...(parsed as Prisma.SiteSettingUncheckedCreateInput) },
  });
  await logActivity("settings.updated", `${admin.name} updated ${def.label}`, { actorId: admin.id, entityType: "settings" });
  revalidateSite();
  return { ok: true, message: `Saved ${def.label} — live on the site now.` };
});
