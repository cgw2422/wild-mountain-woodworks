"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { AdminError, adminAction, fd } from "@/lib/admin/action";
import { revalidateSite } from "@/lib/revalidate";
import { siteDateTime } from "@/lib/site-time";
import { contrastRatio, DEFAULT_ANNOUNCEMENT_COLORS, isHexColor, MIN_ANNOUNCEMENT_CONTRAST, safeLinkUrl } from "@/lib/promotions/announcement";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => v.replace(/\s+/g, " "));

export const createAnnouncement = adminAction(async (admin, data: FormData) => {
  const name = text(80).pipe(z.string().min(1, "Give it a name, e.g. “Fall Sale 2026”.")).parse(fd.str(data, "name"));
  const a = await prisma.announcement.create({
    data: {
      name,
      enabled: false,
      message: name,
      backgroundColor: DEFAULT_ANNOUNCEMENT_COLORS.background,
      textColor: DEFAULT_ANNOUNCEMENT_COLORS.text,
    },
  });
  await logActivity("announcement.created", `${admin.name} created announcement “${name}”`, { actorId: admin.id, entityType: "announcement", entityId: a.id });
  return { ok: true, id: a.id, message: "Announcement created. It stays off until you enable it." };
});

const schema = z.object({
  name: text(80).pipe(z.string().min(1, "Enter a name.")),
  enabled: z.boolean(),
  message: text(140).pipe(z.string().min(1, "Enter the message.")),
  secondaryText: text(120).transform((v) => v || null),
  linkText: text(40).transform((v) => v || null),
  linkUrl: z.string().trim().max(500, "Keep the link under 500 characters."),
  backgroundColor: z.string().trim().toLowerCase(),
  textColor: z.string().trim().toLowerCase(),
  startsAt: z.string().trim().max(20),
  endsAt: z.string().trim().max(20),
  showEndDate: z.boolean(),
  dismissible: z.boolean(),
  showOnDesktop: z.boolean(),
  showOnMobile: z.boolean(),
});

/** Validate everything server-side; the admin form's preview is only a convenience. */
export const saveAnnouncement = adminAction(async (admin, id: string, data: FormData) => {
  const input = schema.parse({
    name: fd.str(data, "name"),
    enabled: fd.bool(data, "enabled"),
    message: fd.str(data, "message"),
    secondaryText: fd.str(data, "secondaryText"),
    linkText: fd.str(data, "linkText"),
    linkUrl: fd.str(data, "linkUrl"),
    backgroundColor: fd.str(data, "backgroundColor"),
    textColor: fd.str(data, "textColor"),
    startsAt: fd.str(data, "startsAt"),
    endsAt: fd.str(data, "endsAt"),
    showEndDate: fd.bool(data, "showEndDate"),
    dismissible: fd.bool(data, "dismissible"),
    showOnDesktop: fd.bool(data, "showOnDesktop"),
    showOnMobile: fd.bool(data, "showOnMobile"),
  });

  const errors: Record<string, string> = {};
  const linkUrl = input.linkUrl ? safeLinkUrl(input.linkUrl) : null;
  if (input.linkUrl && !linkUrl) errors.linkUrl = "Use a page on this site like /furniture/sale, or a full https:// address.";
  if (input.linkText && !linkUrl && !errors.linkUrl) errors.linkUrl = "Add the link address for this link text.";
  if (!isHexColor(input.backgroundColor)) errors.backgroundColor = "Choose a color.";
  if (!isHexColor(input.textColor)) errors.textColor = "Choose a color.";
  if (!errors.backgroundColor && !errors.textColor && contrastRatio(input.backgroundColor, input.textColor) < MIN_ANNOUNCEMENT_CONTRAST) {
    errors.textColor = "These colors are too close to read comfortably. Try one of the brand presets.";
  }
  const startsAt = input.startsAt ? siteDateTime(input.startsAt) : null;
  const endsAt = input.endsAt ? siteDateTime(input.endsAt) : null;
  if (input.startsAt && !startsAt) errors.startsAt = "Choose a valid date and time.";
  if (input.endsAt && !endsAt) errors.endsAt = "Choose a valid date and time.";
  if (startsAt && endsAt && endsAt <= startsAt) errors.endsAt = "The end must be after the start.";
  if (Object.keys(errors).length) throw new AdminError("Please correct the highlighted fields.", errors);

  if (input.enabled && !input.showOnDesktop && !input.showOnMobile) throw new AdminError("Show it on desktop, mobile or both — or switch it off.");

  const existing = await prisma.announcement.findUnique({ where: { id } });
  if (!existing) throw new AdminError("That announcement no longer exists.");
  // New wording or link = a new promotion as far as visitors' "closed" memory goes.
  const reworded =
    existing.message !== input.message || existing.secondaryText !== input.secondaryText || existing.linkText !== input.linkText || existing.linkUrl !== linkUrl;

  await prisma.announcement.update({
    where: { id },
    data: { ...input, linkUrl, startsAt, endsAt, revision: reworded ? { increment: 1 } : undefined },
  });
  const state = input.enabled ? "enabled" : "off";
  await logActivity("announcement.updated", `${admin.name} updated announcement “${input.name}” (${state})`, { actorId: admin.id, entityType: "announcement", entityId: id });
  revalidateSite();
  return { ok: true, message: "Announcement saved." };
});

export const deleteAnnouncement = adminAction(async (admin, id: string) => {
  const a = await prisma.announcement.findUnique({ where: { id }, select: { name: true } });
  if (!a) throw new AdminError("This announcement was already deleted.");
  await prisma.announcement.delete({ where: { id } });
  await logActivity("announcement.deleted", `${admin.name} deleted announcement “${a.name}”`, { actorId: admin.id, entityType: "announcement", entityId: id });
  revalidateSite();
  return { ok: true, message: "Announcement deleted." };
});
