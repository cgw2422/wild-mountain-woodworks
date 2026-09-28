"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { CmsImageData } from "@/components/media/CmsImage";
import { IMAGE_SLOTS } from "@/lib/media/slots";
import { RidgeLine } from "@/components/brand/Logo";

type GalleryImage = CmsImageData & { id: string };

/**
 * Product gallery.
 * - Desktop: large main image with a thumbnail rail.
 * - Mobile: full-bleed swipeable carousel (scroll-snap) with position dots.
 * - Both open an accessible full-screen lightbox (Esc to close, arrow keys).
 */
export function ProductGallery({ images, productName }: { images: GalleryImage[]; productName: string }) {
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const ratio = IMAGE_SLOTS.productGallery.ratio;

  const onTrackScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setActive((prev) => (prev === i ? prev : i));
  }, []);

  if (!images.length) {
    return (
      <div className="flex items-center justify-center bg-stone-light" style={{ aspectRatio: String(ratio) }}>
        <RidgeLine className="h-6 w-24 text-stone-dark" />
      </div>
    );
  }

  const current = images[active] ?? images[0]!;

  return (
    <div>
      {/* Mobile carousel */}
      <div className="lg:hidden">
        <div
          ref={trackRef}
          onScroll={onTrackScroll}
          className="-mx-5 flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] sm:-mx-8 [&::-webkit-scrollbar]:hidden"
          aria-label={`${productName} photos`}
          role="region"
          tabIndex={0}
        >
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setLightbox(i)}
              className="relative w-full shrink-0 snap-center bg-stone-light"
              style={{ aspectRatio: "4 / 5" }}
              aria-label={`View photo ${i + 1} of ${images.length} larger`}
            >
              <Image
                src={img.url}
                alt={img.alt || productName}
                fill
                priority={i === 0}
                sizes="100vw"
                className="object-cover"
                style={{ objectPosition: `${img.focalX ?? 50}% ${img.focalY ?? 50}%` }}
                placeholder={img.blurDataUrl ? "blur" : "empty"}
                blurDataURL={img.blurDataUrl ?? undefined}
              />
            </button>
          ))}
        </div>
        {images.length > 1 ? (
          <div className="mt-4 flex justify-center gap-2" aria-hidden="true">
            {images.map((img, i) => (
              <span key={img.id} className={cn("h-1 w-6 transition-colors", i === active ? "bg-charcoal" : "bg-stone")} />
            ))}
          </div>
        ) : null}
        <p className="sr-only" aria-live="polite">
          Photo {active + 1} of {images.length}
        </p>
      </div>

      {/* Desktop */}
      <div className="hidden lg:block">
        <button
          type="button"
          onClick={() => setLightbox(active)}
          className="group relative block w-full cursor-zoom-in overflow-hidden bg-stone-light"
          style={{ aspectRatio: String(ratio) }}
          aria-label="View larger"
        >
          <Image
            key={current.id}
            src={current.url}
            alt={current.alt || productName}
            fill
            priority
            sizes={IMAGE_SLOTS.productGallery.sizes}
            className="animate-fade object-cover transition-transform duration-[1.2s] group-hover:scale-[1.02]"
            style={{ objectPosition: `${current.focalX ?? 50}% ${current.focalY ?? 50}%` }}
            placeholder={current.blurDataUrl ? "blur" : "empty"}
            blurDataURL={current.blurDataUrl ?? undefined}
          />
        </button>
        {images.length > 1 ? (
          <ul className="mt-4 grid grid-cols-5 gap-3" aria-label="Choose photo">
            {images.map((img, i) => (
              <li key={img.id}>
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-current={i === active ? "true" : undefined}
                  aria-label={`Show photo ${i + 1}${img.alt ? `: ${img.alt}` : ""}`}
                  className={cn(
                    "relative block aspect-square w-full overflow-hidden bg-stone-light transition",
                    i === active ? "ring-1 ring-charcoal ring-offset-2 ring-offset-ivory" : "opacity-70 hover:opacity-100",
                  )}
                >
                  <Image src={img.url} alt="" fill sizes="140px" className="object-cover" style={{ objectPosition: `${img.focalX ?? 50}% ${img.focalY ?? 50}%` }} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <Lightbox images={images} index={lightbox} onClose={() => setLightbox(null)} onIndex={setLightbox} productName={productName} />
    </div>
  );
}

function Lightbox({
  images,
  index,
  onClose,
  onIndex,
  productName,
}: {
  images: GalleryImage[];
  index: number | null;
  onClose: () => void;
  onIndex: (i: number) => void;
  productName: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = index != null;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") onIndex(((index ?? 0) + 1) % images.length);
      if (e.key === "ArrowLeft") onIndex(((index ?? 0) - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, images.length, onIndex]);

  const img = index != null ? images[index] : null;
  return (
    <dialog
      ref={ref}
      aria-label={`${productName} photos`}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="on-dark m-0 h-dvh max-h-none w-full max-w-none bg-charcoal/97 p-0 text-ivory backdrop:bg-charcoal/80"
    >
      {img ? (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-5 py-4 text-sm text-ivory/70">
            <span>
              {index! + 1} / {images.length}
            </span>
            <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center text-ivory" aria-label="Close">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                <path d="M5 5l14 14M19 5L5 19" />
              </svg>
            </button>
          </div>
          <div className="relative min-h-0 flex-1">
            <Image key={img.id} src={img.url} alt={img.alt || productName} fill sizes="100vw" className="animate-fade object-contain" quality={85} />
          </div>
          {images.length > 1 ? (
            <div className="flex justify-center gap-4 py-4">
              <button
                type="button"
                onClick={() => onIndex((index! - 1 + images.length) % images.length)}
                className="flex h-12 w-12 items-center justify-center border border-ivory/30 hover:border-ivory"
                aria-label="Previous photo"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => onIndex((index! + 1) % images.length)}
                className="flex h-12 w-12 items-center justify-center border border-ivory/30 hover:border-ivory"
                aria-label="Next photo"
              >
                →
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
