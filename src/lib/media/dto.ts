/** Media shape sent to admin client components (safe for client import). */
export interface MediaDTO {
  id: string;
  url: string;
  alt: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  focalX: number;
  focalY: number;
  blurDataUrl: string | null;
  createdAt: string;
  usageCount?: number;
}

export function toMediaDTO(m: {
  id: string;
  url: string;
  alt: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  focalX: number;
  focalY: number;
  blurDataUrl: string | null;
  createdAt: Date;
}, usageCount?: number): MediaDTO {
  return {
    id: m.id,
    url: m.url,
    alt: m.alt,
    filename: m.filename,
    originalName: m.originalName,
    mimeType: m.mimeType,
    size: m.size,
    width: m.width,
    height: m.height,
    focalX: m.focalX,
    focalY: m.focalY,
    blurDataUrl: m.blurDataUrl,
    createdAt: m.createdAt.toISOString(),
    usageCount,
  };
}
