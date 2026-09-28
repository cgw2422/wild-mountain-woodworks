"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { AdminError, adminAction, fd } from "@/lib/admin/action";
import { deleteMedia } from "@/lib/media/service";
import { revalidateSite } from "@/lib/revalidate";

const detailsSchema = z.object({
  alt: z.string().trim().max(300, "Keep alt text under 300 characters."),
  caption: z
    .string()
    .trim()
    .max(500, "Keep the caption under 500 characters.")
    .transform((v) => (v ? v : null)),
  focalX: z.coerce.number().int().min(0, "Use 0–100.").max(100, "Use 0–100."),
  focalY: z.coerce.number().int().min(0, "Use 0–100.").max(100, "Use 0–100."),
});

export const updateMediaDetails = adminAction(async (admin, id: string, data: FormData) => {
  const parsed = detailsSchema.parse({
    alt: fd.str(data, "alt"),
    caption: fd.str(data, "caption"),
    focalX: fd.str(data, "focalX") || "50",
    focalY: fd.str(data, "focalY") || "50",
  });
  const media = await prisma.media.update({ where: { id }, data: parsed });
  await logActivity("media.updated", `${admin.name} updated alt text/focal point for ${media.originalName}`, {
    actorId: admin.id,
    entityType: "media",
    entityId: id,
  });
  revalidateSite();
  return { ok: true, message: parsed.alt ? "Image details saved." : "Saved. Tip: add alt text so this image is accessible." };
});

/**
 * Delete a media item. Without `force`, refuses while the image is in use.
 * With `force`, every reference is detached first (never silently broken).
 */
export const deleteMediaItem = adminAction(async (admin, id: string, force: boolean) => {
  const media = await prisma.media.findUnique({ where: { id }, select: { originalName: true } });
  if (!media) throw new AdminError("This image was already deleted.");
  const result = await deleteMedia(id, { force: Boolean(force) });
  if (!result.deleted) {
    const n = result.usage.length;
    throw new AdminError(`This image is now used in ${n} location${n === 1 ? "" : "s"}. Reload the page to review them before deleting.`);
  }
  const n = result.usage.length;
  await logActivity(
    "media.deleted",
    n
      ? `${admin.name} deleted ${media.originalName} and removed it from ${n} location${n === 1 ? "" : "s"}`
      : `${admin.name} deleted ${media.originalName}`,
    { actorId: admin.id, entityType: "media", entityId: id },
  );
  revalidateSite();
  return { ok: true, message: "Image deleted." };
});
