import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * Small cropped thumbnail for admin tables/lists. Crops around the image's
 * focal point at the given aspect ratio (defaults to the 4:5 product card).
 */
export function CatalogThumb({
  image,
  ratio = 4 / 5,
  className,
  label = "No image",
}: {
  image: { url: string; alt: string; focalX: number; focalY: number } | null | undefined;
  ratio?: number;
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn("relative block shrink-0 overflow-hidden rounded border border-neutral-200 bg-neutral-100", className ?? "w-12")}
      style={{ aspectRatio: String(ratio) }}
    >
      {image ? (
        <Image
          src={image.url}
          alt={image.alt}
          fill
          sizes="96px"
          className="object-cover"
          style={{ objectPosition: `${image.focalX}% ${image.focalY}%` }}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center p-1 text-center text-[0.6rem] leading-tight text-neutral-400">{label}</span>
      )}
    </span>
  );
}
