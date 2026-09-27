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
