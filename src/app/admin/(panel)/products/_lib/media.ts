import type { ImageValue } from "@/components/admin/media/ImageField";

/** Pick only what the admin ImageField needs from a Media row. */
export function toImageValue(
  m: { id: string; url: string; alt: string; width: number; height: number; focalX: number; focalY: number; originalName: string } | null | undefined,
): ImageValue | null {
  if (!m) return null;
  return { id: m.id, url: m.url, alt: m.alt, width: m.width, height: m.height, focalX: m.focalX, focalY: m.focalY, originalName: m.originalName };
}
