import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getStorage } from "@/lib/storage";
import { buildStorageKey, UploadError } from "./process";
import { createMediaFromFile, deleteMedia } from "./service";
import { ALLOWED_VIDEO_TYPES, extensionOf, precheckVideoFile, sniffVideoType, videoMimeFor } from "./validate";

export interface VideoMeta {
  width: number;
  height: number;
  durationSec: number;
  title?: string;
}

const MAX_DIMENSION = 8192;
const MAX_DURATION_SEC = 60 * 60;

/**
 * Validate an uploaded video: extension, declared type and the container
 * found in the file's first bytes must agree. MP4 and MOV share the ISO-BMFF
 * container and are interchangeable here; both are served as video/mp4,
 * which lets Chrome and Firefox play H.264 .mov files as well as Safari does.
 */
export async function inspectVideo(file: File) {
  const pre = precheckVideoFile(file);
  if (pre) throw new UploadError(pre);
  const declared = videoMimeFor(file)!;
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffVideoType(head);
  if (!sniffed) throw new UploadError(`${file.name} could not be read as a video.`);
  const isoFamily = (m: string) => m === "video/mp4" || m === "video/quicktime";
  if (sniffed !== declared && !(isoFamily(sniffed) && isoFamily(declared))) {
    throw new UploadError(`${file.name}'s contents don't match its file type.`);
  }
  const ext = extensionOf(file.name);
  return {
    buffer: Buffer.from(await file.arrayBuffer()),
    contentType: sniffed === "video/webm" ? "video/webm" : "video/mp4",
    extension: (ALLOWED_VIDEO_TYPES[declared] as readonly string[]).includes(ext) ? ext : ALLOWED_VIDEO_TYPES[declared][0],
  };
}

function checkMeta(meta: VideoMeta) {
  const ok = (n: number, max: number) => Number.isFinite(n) && n > 0 && n <= max;
  if (!ok(meta.width, MAX_DIMENSION) || !ok(meta.height, MAX_DIMENSION)) throw new UploadError("The video's dimensions couldn't be read.");
  if (!ok(meta.durationSec, MAX_DURATION_SEC)) throw new UploadError("The video's length couldn't be read.");
}

/** Store a video (and its poster frame, if provided) and append it to the product's videos. */
export async function createProductVideo(
  productId: string,
  file: File,
  poster: File | null,
  meta: VideoMeta,
  opts: { uploadedById?: string | null } = {},
) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true } });
  if (!product) throw new UploadError("That product no longer exists.");
  checkMeta(meta);
  const video = await inspectVideo(file);
  const title = (meta.title ?? "").trim().slice(0, 200);

  const posterMedia = poster && poster.size > 0 ? await createMediaFromFile(poster, { uploadedById: opts.uploadedById, alt: title || `${product.name} video` }) : null;
  const storage = getStorage();
  const key = buildStorageKey("media", file.name, video.extension);
  try {
    await storage.put(key, video.buffer, video.contentType);
    const last = await prisma.productVideo.aggregate({ where: { productId }, _max: { sortOrder: true } });
    return await prisma.productVideo.create({
      data: {
        productId,
        storageKey: key,
        url: storage.publicUrl(key),
        originalName: file.name.slice(0, 200),
        mimeType: video.contentType,
        size: video.buffer.length,
        width: Math.round(meta.width),
        height: Math.round(meta.height),
        durationSec: Math.round(meta.durationSec * 10) / 10,
        title,
        posterId: posterMedia?.id ?? null,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
        uploadedById: opts.uploadedById ?? null,
      },
    });
  } catch (error) {
    await storage.delete(key).catch(() => undefined);
    if (posterMedia) await deleteMedia(posterMedia.id).catch(() => undefined);
    throw error;
  }
}

/**
 * Remove stored files that no ProductVideo row references any more (a
 * duplicated product shares its source's files). Poster images are deleted
 * only when nothing else uses them.
 */
export async function cleanupVideoFiles(rows: Array<{ storageKey: string; posterId: string | null }>) {
  const storage = getStorage();
  for (const key of new Set(rows.map((r) => r.storageKey))) {
    if ((await prisma.productVideo.count({ where: { storageKey: key } })) === 0) {
      await storage.delete(key).catch((error) => logger.warn("Video object not deleted from storage", { error, key }));
    }
  }
  for (const posterId of new Set(rows.map((r) => r.posterId).filter((id): id is string => Boolean(id)))) {
    await deleteMedia(posterId).catch((error) => logger.warn("Video poster not deleted", { error, posterId }));
  }
}

/** Delete one video row and any files no longer referenced. */
export async function deleteProductVideo(videoId: string, productId: string) {
  const row = await prisma.productVideo.findFirst({ where: { id: videoId, productId } });
  if (!row) return null;
  await prisma.productVideo.delete({ where: { id: row.id } });
  await cleanupVideoFiles([row]);
  return row;
}

/** ISO 8601 duration for structured data, e.g. 75.4 s → "PT1M15S". */
export function isoDuration(seconds: number) {
  const s = Math.max(1, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${sec ? `${sec}S` : ""}`;
}
