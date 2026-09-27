import Image from "next/image";
import { cn } from "@/lib/cn";
import { IMAGE_SLOTS, type ImageSlot } from "@/lib/media/slots";
import { RidgeLine } from "@/components/brand/Logo";

export interface CmsImageData {
  url: string;
  alt: string;
  width: number;
  height: number;
  focalX?: number | null;
  focalY?: number | null;
  blurDataUrl?: string | null;
}

interface CmsImageProps {
  image: CmsImageData | null | undefined;
  slot: ImageSlot;
  alt?: string;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
  sizes?: string;
  /** Override the slot's ratio (e.g. fill a parent that sets its own size). */
  fill?: boolean;
  /** Use the slot's mobile ratio below the md breakpoint when it has one. */
  responsiveRatio?: boolean;
  placeholderLabel?: string;
}

/**
 * Renders an admin-managed image in a design location. The original upload is
 * preserved; this crops at display time to the slot's aspect ratio, centered
 * on the image's focal point, with responsive `srcset` via next/image.
 */
export function CmsImage({
  image,
  slot,
  alt,
  className,
  imgClassName,
  priority,
  sizes,
  fill,
  responsiveRatio,
  placeholderLabel,
}: CmsImageProps) {
  const def = IMAGE_SLOTS[slot];
  const mobileRatio = "mobileRatio" in def ? def.mobileRatio : undefined;
  const style: React.CSSProperties & Record<string, string | number> = fill
    ? {}
    : responsiveRatio && mobileRatio
      ? { "--r-mobile": String(mobileRatio), "--r-desktop": String(def.ratio) }
      : { aspectRatio: String(def.ratio) };

  const wrapper = cn(
    "relative overflow-hidden bg-stone-light",
    fill && "h-full w-full",
    !fill && responsiveRatio && mobileRatio && "[aspect-ratio:var(--r-mobile)] md:[aspect-ratio:var(--r-desktop)]",
    className,
  );

  if (!image) {
    return (
      <div className={cn(wrapper, "flex items-center justify-center")} style={style} role="presentation">
        <div className="flex flex-col items-center gap-3 text-stone-dark">
          <RidgeLine className="h-5 w-20" />
          {placeholderLabel ? <span className="eyebrow text-[0.62rem]">{placeholderLabel}</span> : null}
        </div>
      </div>
    );
  }

  const blur = image.blurDataUrl && image.blurDataUrl.length < 3000 ? image.blurDataUrl : undefined;
  return (
    <div className={wrapper} style={style}>
      <Image
        src={image.url}
        alt={alt ?? image.alt ?? ""}
        fill
        sizes={sizes ?? def.sizes}
        priority={priority}
        placeholder={blur ? "blur" : "empty"}
        blurDataURL={blur}
        className={cn("object-cover", imgClassName)}
        style={{ objectPosition: `${image.focalX ?? 50}% ${image.focalY ?? 50}%` }}
      />
    </div>
  );
}
