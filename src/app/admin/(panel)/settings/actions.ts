"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { AdminError, adminAction, fd } from "@/lib/admin/action";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
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

/* Account ------------------------------------------------------------------- */

export const changePassword = adminAction(async (admin, data: FormData) => {
  const current = typeof data.get("currentPassword") === "string" ? String(data.get("currentPassword")) : "";
  const next = typeof data.get("newPassword") === "string" ? String(data.get("newPassword")) : "";
  const confirm = typeof data.get("confirmPassword") === "string" ? String(data.get("confirmPassword")) : "";
  const errors: Record<string, string> = {};
  if (!current) errors.currentPassword = "Enter your current password.";
  const strength = validatePasswordStrength(next);
  if (strength) errors.newPassword = strength;
  if (next !== confirm) errors.confirmPassword = "The passwords don't match.";
  if (Object.keys(errors).length) throw new AdminError("Please correct the highlighted fields.", errors);

  const user = await prisma.adminUser.findUnique({ where: { id: admin.id }, select: { passwordHash: true } });
  if (!user || !(await verifyPassword(current, user.passwordHash))) {
    throw new AdminError("Your current password is incorrect.", { currentPassword: "Incorrect password." });
  }
  if (await verifyPassword(next, user.passwordHash)) {
    throw new AdminError("Choose a password you haven't used here.", { newPassword: "This is your current password." });
  }
  await prisma.$transaction([
    prisma.adminUser.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(next) } }),
    // Sign out every other device; keep this session.
    prisma.adminSession.deleteMany({ where: { userId: admin.id, id: { not: admin.sessionId } } }),
  ]);
  await logActivity("account.password_changed", `${admin.name} changed their password`, { actorId: admin.id, entityType: "admin", entityId: admin.id });
  return { ok: true, message: "Password changed. You've been signed out on other devices." };
});

/* Admin users (owner only) --------------------------------------------------- */

function requireOwner(admin: { role: string }) {
  if (admin.role !== "OWNER") throw new AdminError("Only the owner can manage admin users.");
}

export const createAdminUser = adminAction(async (admin, data: FormData) => {
  requireOwner(admin);
  const parsed = z
    .object({
      name: reqText(120, "Enter a name."),
      email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address.")),
      role: z.enum(["OWNER", "ADMIN", "EDITOR"]),
    })
    .parse({ name: fd.str(data, "name"), email: fd.str(data, "email"), role: fd.str(data, "role") || "ADMIN" });
  const password = typeof data.get("password") === "string" ? String(data.get("password")) : "";
  const strength = validatePasswordStrength(password);
  if (strength) throw new AdminError("Please correct the highlighted fields.", { password: strength });
  if (await prisma.adminUser.findUnique({ where: { email: parsed.email }, select: { id: true } })) {
    throw new AdminError("Please correct the highlighted fields.", { email: "An admin with this email already exists." });
  }
  const user = await prisma.adminUser.create({ data: { ...parsed, passwordHash: await hashPassword(password), active: true } });
  await logActivity("admin.created", `${admin.name} added admin user ${parsed.name} (${parsed.role.toLowerCase()})`, {
    actorId: admin.id,
    entityType: "admin",
    entityId: user.id,
  });
  return { ok: true, message: `${parsed.name} can now sign in. Share the initial password securely and ask them to change it.` };
});

export const setAdminActive = adminAction(async (admin, userId: string, active: boolean) => {
  requireOwner(admin);
  if (userId === admin.id && !active) throw new AdminError("You can't deactivate your own account.");
  const user = await prisma.adminUser.findUnique({ where: { id: userId }, select: { name: true, role: true, active: true } });
  if (!user) throw new AdminError("That admin no longer exists.");
  if (!active && user.role === "OWNER") {
    const owners = await prisma.adminUser.count({ where: { role: "OWNER", active: true } });
    if (owners <= 1) throw new AdminError("You can't deactivate the last active owner.");
  }
  await prisma.$transaction([
    prisma.adminUser.update({ where: { id: userId }, data: { active } }),
    ...(active ? [] : [prisma.adminSession.deleteMany({ where: { userId } })]),
  ]);
  await logActivity("admin.updated", `${admin.name} ${active ? "reactivated" : "deactivated"} admin user ${user.name}`, {
    actorId: admin.id,
    entityType: "admin",
    entityId: userId,
  });
  return { ok: true, message: active ? `${user.name} reactivated.` : `${user.name} deactivated and signed out.` };
});
