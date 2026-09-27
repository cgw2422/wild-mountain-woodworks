import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { guardAdminApi } from "@/lib/admin/api";
import { logger } from "@/lib/logger";
import { toMediaDTO } from "@/lib/media/dto";
import { UploadError } from "@/lib/media/process";
import { createMediaFromFile, getMediaUsageCounts } from "@/lib/media/service";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

/** List media for the picker/library. ?q=search&page=1&pageSize=40 */
export async function GET(request: Request) {
  const guard = await guardAdminApi(request);
  if ("error" in guard) return guard.error;
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 40) || 40));
  const where: Prisma.MediaWhereInput = q
    ? {
        OR: [
          { originalName: { contains: q, mode: "insensitive" } },
          { filename: { contains: q, mode: "insensitive" } },
          { alt: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};
  const [items, total] = await Promise.all([
    prisma.media.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.media.count({ where }),
  ]);
  const counts = await getMediaUsageCounts(items.map((i) => i.id));
  return Response.json({ items: items.map((m) => toMediaDTO(m, counts[m.id])), total, page, pageSize });
}

/** Upload one or more images (multipart field "files"). */
export async function POST(request: Request) {
  const guard = await guardAdminApi(request);
  if ("error" in guard) return guard.error;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Upload could not be read." }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  if (files.length === 0) return Response.json({ error: "No files were uploaded." }, { status: 400 });
  if (files.length > 30) return Response.json({ error: "Upload at most 30 images at a time." }, { status: 400 });
  const alt = typeof form.get("alt") === "string" ? String(form.get("alt")) : undefined;

  const created = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      const media = await createMediaFromFile(file, { uploadedById: guard.admin.id, alt });
      created.push(toMediaDTO(media, 0));
    } catch (err) {
      if (err instanceof UploadError) errors.push(err.message);
      else {
        logger.error("Media upload failed", { error: err, file: file.name });
        errors.push(`${file.name} could not be uploaded. Please try again.`);
      }
    }
  }
  if (created.length) {
    await logActivity("media.uploaded", `${guard.admin.name} uploaded ${created.length} image${created.length > 1 ? "s" : ""}`, { actorId: guard.admin.id, entityType: "media" });
  }
  return Response.json({ items: created, errors }, { status: created.length ? 201 : 400 });
}
