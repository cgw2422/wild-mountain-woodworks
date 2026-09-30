import { logActivity } from "@/lib/activity";
import { guardAdminApi } from "@/lib/admin/api";
import { logger } from "@/lib/logger";
import { toMediaDTO } from "@/lib/media/dto";
import { UploadError } from "@/lib/media/process";
import { replaceMediaFile } from "@/lib/media/service";
import { revalidateSite } from "@/lib/revalidate";

/** Replace the file behind a media item everywhere it is used. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminApi(request, "media");
  if ("error" in guard) return guard.error;
  const { id } = await ctx.params;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return Response.json({ error: "No file uploaded." }, { status: 400 });
  try {
    const media = await replaceMediaFile(id, file);
    await logActivity("media.replaced", `${guard.admin.name} replaced ${media.originalName}`, { actorId: guard.admin.id, entityType: "media", entityId: id });
    revalidateSite();
    return Response.json({ item: toMediaDTO(media) });
  } catch (err) {
    if (err instanceof UploadError) return Response.json({ error: err.message }, { status: 400 });
    logger.error("Media replace failed", { error: err });
    return Response.json({ error: "The image could not be replaced." }, { status: 500 });
  }
}
