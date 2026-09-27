import "server-only";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { slugify } from "@/lib/slug";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_PIXELS, precheckImageFile, type AllowedImageMime } from "./validate";

const FORMAT_TO_MIME: Record<string, AllowedImageMime> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heif: "image/avif", // sharp reports AVIF as "heif"
};

export class UploadError extends Error {}

export interface InspectedImage {
  buffer: Buffer;
  mimeType: AllowedImageMime;
  extension: string;
  width: number;
  height: number;
  blurDataUrl: string;
}

/**
 * Validates the real content of an uploaded image and extracts dimensions.
 * The original bytes are preserved untouched; cropping for each design
 * location happens at display time (focal point + aspect ratio).
 */
export async function inspectImage(file: File, maxBytes: number): Promise<InspectedImage> {
  const pre = precheckImageFile(file, maxBytes);
  if (pre) throw new UploadError(pre);

  const buffer = Buffer.from(await file.arrayBuffer());
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  } catch {
    throw new UploadError(`${file.name} could not be read as an image.`);
  }
  const detected = meta.format ? FORMAT_TO_MIME[meta.format] : undefined;
  if (!detected) throw new UploadError(`${file.name} is not a supported image format.`);
  if (detected !== file.type) {
    throw new UploadError(`${file.name}'s contents don't match its file type.`);
  }
  if (!meta.width || !meta.height) throw new UploadError(`${file.name} has no readable dimensions.`);

  // EXIF orientations 5–8 swap width/height when displayed.
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = rotated ? meta.height : meta.width;
  const height = rotated ? meta.width : meta.height;

  const blur = await sharp(buffer).rotate().resize(16, 16, { fit: "inside" }).webp({ quality: 40 }).toBuffer();

  return {
    buffer,
    mimeType: detected,
    extension: ALLOWED_IMAGE_TYPES[detected][0],
    width,
    height,
    blurDataUrl: `data:image/webp;base64,${blur.toString("base64")}`,
  };
}

export function buildStorageKey(prefix: "media" | "private", originalName: string, extension: string) {
  const now = new Date();
  const base = slugify(originalName.replace(/\.[^.]+$/, "")).slice(0, 50) || "image";
  const id = randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "x");
  const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${prefix}/${month}/${id}-${base}.${extension}`;
}
