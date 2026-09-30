import { logActivity } from "@/lib/activity";
import { guardAdminApi } from "@/lib/admin/api";
import { logger } from "@/lib/logger";
import { UploadError } from "@/lib/media/process";
import { createProductVideo } from "@/lib/media/video";
import { revalidateSite } from "@/lib/revalidate";
import { storageErrorHint } from "@/lib/storage/errors";

export const dynamic = "force-dynamic";

/**
 * Upload one product video (multipart): "video" (the file), "poster" (a JPEG
 * frame captured in the admin's browser), "width", "height", "duration"
 * (seconds) and optional "title".
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminApi(request, "catalog");
  if ("error" in guard) return guard.error;
  const { id } = await ctx.params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Upload could not be read." }, { status: 400 });
  }
  const video = form.get("video");
  const poster = form.get("poster");
  if (!(video instanceof File) || video.size === 0) return Response.json({ error: "No video was uploaded." }, { status: 400 });
  const num = (k: string) => Number(form.get(k));

  try {
    const created = await createProductVideo(
      id,
      video,
      poster instanceof File ? poster : null,
      { width: num("width"), height: num("height"), durationSec: num("duration"), title: typeof form.get("title") === "string" ? String(form.get("title")) : "" },
      { uploadedById: guard.admin.id },
    );
    await logActivity("product.updated", `${guard.admin.name} added a video to a product`, { actorId: guard.admin.id, entityType: "product", entityId: id });
    revalidateSite();
    return Response.json({ id: created.id }, { status: 201 });
  } catch (err) {
    if (err instanceof UploadError) return Response.json({ error: err.message }, { status: 400 });
    logger.error("Product video upload failed", { error: err, file: video.name });
    return Response.json({ error: `${video.name} could not be uploaded. ${storageErrorHint(err)}` }, { status: 500 });
  }
}
