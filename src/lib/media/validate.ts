/**
 * Upload restrictions shared by admin media uploads and customer reference
 * images. Checked three ways: extension, declared MIME type, and the actual
 * decoded file format (magic bytes via sharp).
 */
export const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/avif": ["avif"],
} as const;

export type AllowedImageMime = keyof typeof ALLOWED_IMAGE_TYPES;

export const MEDIA_MAX_BYTES = 25 * 1024 * 1024; // admin uploads
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // customer reference images
export const ATTACHMENT_MAX_FILES = 5;
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/avif";
export const MAX_IMAGE_PIXELS = 12000 * 12000;

export function extensionOf(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  return m ? m[1]!.toLowerCase() : "";
}

/** Fast pre-check (client + server) before decoding. Returns an error message or null. */
export function precheckImageFile(file: { name: string; type: string; size: number }, maxBytes: number): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > maxBytes) return `${file.name} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`;
  const allowed = ALLOWED_IMAGE_TYPES[file.type as AllowedImageMime];
  if (!allowed) return `${file.name} is not a supported image type (JPG, PNG, WebP or AVIF).`;
  const ext = extensionOf(file.name);
  if (!(allowed as readonly string[]).includes(ext)) return `${file.name} has an extension that doesn't match its type.`;
  return null;
}

/* ------------------------------------------------------------------ video */

/**
 * Product videos. There's no server-side transcoding, so files are stored as
 * uploaded: MP4 (H.264) plays in every browser; WebM and MOV are accepted but
 * may not play everywhere (the admin UI says so).
 */
export const ALLOWED_VIDEO_TYPES = {
  "video/mp4": ["mp4", "m4v"],
  "video/webm": ["webm"],
  "video/quicktime": ["mov"],
} as const;

export type AllowedVideoMime = keyof typeof ALLOWED_VIDEO_TYPES;

export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
export const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov";

/** Browsers sometimes report an empty or generic type for .mov/.m4v; fall back to the extension. */
export function videoMimeFor(file: { name: string; type: string }): AllowedVideoMime | null {
  if (file.type in ALLOWED_VIDEO_TYPES) return file.type as AllowedVideoMime;
  const ext = extensionOf(file.name);
  for (const [mime, exts] of Object.entries(ALLOWED_VIDEO_TYPES)) if ((exts as readonly string[]).includes(ext)) return mime as AllowedVideoMime;
  return null;
}

/** Fast pre-check (client + server) before reading the file. Returns an error message or null. */
export function precheckVideoFile(file: { name: string; type: string; size: number }, maxBytes = VIDEO_MAX_BYTES): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > maxBytes) return `${file.name} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB. Export it at 1080p or trim it, then try again.`;
  const mime = videoMimeFor(file);
  if (!mime) return `${file.name} is not a supported video type (MP4, WebM or MOV).`;
  if (!(ALLOWED_VIDEO_TYPES[mime] as readonly string[]).includes(extensionOf(file.name))) return `${file.name} has an extension that doesn't match its type.`;
  return null;
}

/**
 * Identify the container from the first bytes of the file:
 * ISO-BMFF ("ftyp" at offset 4) is MP4, or MOV when the brand is "qt  ";
 * EBML (1A 45 DF A3) is WebM.
 */
export function sniffVideoType(head: Uint8Array): AllowedVideoMime | null {
  if (head.length >= 12 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) {
    const brand = String.fromCharCode(head[8]!, head[9]!, head[10]!, head[11]!);
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video/webm";
  return null;
}
