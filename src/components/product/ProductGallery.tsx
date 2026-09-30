"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { CmsImageData } from "@/components/media/CmsImage";
import { IMAGE_SLOTS } from "@/lib/media/slots";
import { RidgeLine } from "@/components/brand/Logo";

type GalleryImage = CmsImageData & { id: string };
export type GalleryVideo = { id: string; url: string; mimeType: string; width: number; height: number; title: string; posterUrl: string | null };
type Item = ({ kind: "image" } & GalleryImage) | ({ kind: "video" } & GalleryVideo);

const itemLabel = (item: Item) => (item.kind === "video" ? "video" : "photo");

function PlayBadge({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className={cn("flex items-center justify-center rounded-full bg-charcoal/70 text-ivory", size === "sm" ? "h-8 w-8" : "h-14 w-14")}>
        <svg viewBox="0 0 24 24" className={size === "sm" ? "ml-0.5 h-3.5 w-3.5" : "ml-1 h-6 w-6"} fill="currentColor">
          <path d="M7 4.5v15l12-7.5z" />
        </svg>
      </span>
    </span>
  );
}

function Video({ item, productName, autoPlay, className }: { item: GalleryVideo; productName: string; autoPlay?: boolean; className?: string }) {
  return (
    <video
      key={item.id}
      controls
      playsInline
      autoPlay={autoPlay}
      preload="metadata"
      poster={item.posterUrl ?? undefined}
      aria-label={item.title || `${productName} video`}
      className={cn("h-full w-full bg-charcoal object-contain", className)}
    >
      <source src={item.url} type={item.mimeType} />
    </video>
  );
}

/**
 * Product gallery: photos first, then videos.
 * - Desktop: large main item with a thumbnail rail.
 * - Mobile: full-bleed swipeable carousel (scroll-snap) with position dots.
 * - Both open an accessible full-screen lightbox (Esc to close, arrow keys).
 * Videos play inline with native controls; they never autoplay on the page.
 */
export function ProductGallery({ images, videos = [], productName }: { images: GalleryImage[]; videos?: GalleryVideo[]; productName: string }) {
  const items: Item[] = [...images.map((i) => ({ kind: "image" as const, ...i })), ...videos.map((v) => ({ kind: "video" as const, ...v }))];
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const ratio = IMAGE_SLOTS.productGallery.ratio;

  const onTrackScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setActive((prev) => (prev === i ? prev : i));
  };

  // Pause mobile slides that have scrolled out of view.
  useEffect(() => {
    trackRef.current?.querySelectorAll("video").forEach((v) => {
      if (Number(v.dataset.index) !== active && !v.paused) v.pause();
    });
  }, [active]);

  if (!items.length) {
    return (
      <div className="flex items-center justify-center bg-stone-light" style={{ aspectRatio: String(ratio) }}>
        <RidgeLine className="h-6 w-24 text-stone-dark" />
      </div>
    );
  }

  const current = items[active] ?? items[0]!;
  const noun = videos.length ? "photos and videos" : "photos";

  return (
    <div>
      {/* Mobile carousel */}
      <div className="lg:hidden">
        <div
          ref={trackRef}
          onScroll={onTrackScroll}
          className="-mx-5 flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] sm:-mx-8 [&::-webkit-scrollbar]:hidden"
          aria-label={`${productName} ${noun}`}
          role="region"
          tabIndex={0}
        >
          {items.map((item, i) =>
            item.kind === "video" ? (
              <div key={item.id} className="relative w-full shrink-0 snap-center bg-charcoal" style={{ aspectRatio: "4 / 5" }}>
                <video
                  controls
                  playsInline
                  preload="metadata"
                  poster={item.posterUrl ?? undefined}
                  aria-label={item.title || `${productName} video`}
                  data-index={i}
                  className="h-full w-full object-contain"
                >
                  <source src={item.url} type={item.mimeType} />
                </video>
              </div>
            ) : (
              <button
                key={item.id}
                type="button"
                onClick={() => setLightbox(i)}
                className="relative w-full shrink-0 snap-center bg-stone-light"
                style={{ aspectRatio: "4 / 5" }}
                aria-label={`View photo ${i + 1} of ${items.length} larger`}
              >
                <Image
                  src={item.url}
                  alt={item.alt || productName}
                  fill
                  priority={i === 0}
                  sizes="100vw"
                  className="object-cover"
                  style={{ objectPosition: `${item.focalX ?? 50}% ${item.focalY ?? 50}%` }}
                  placeholder={item.blurDataUrl ? "blur" : "empty"}
                  blurDataURL={item.blurDataUrl ?? undefined}
                />
              </button>
            ),
          )}
        </div>
        {items.length > 1 ? (
          <div className="mt-4 flex justify-center gap-2" aria-hidden="true">
            {items.map((item, i) => (
              <span key={item.id} className={cn("h-1 w-6 transition-colors", i === active ? "bg-charcoal" : "bg-stone")} />
            ))}
          </div>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {itemLabel(current) === "video" ? "Video" : "Photo"} {active + 1} of {items.length}
        </p>
      </div>

      {/* Desktop */}
      <div className="hidden lg:block">
        {current.kind === "video" ? (
          <div className="relative w-full overflow-hidden bg-charcoal" style={{ aspectRatio: String(ratio) }}>
            <Video item={current} productName={productName} className="absolute inset-0" />
          </div>
        ) : (
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
        )}
        {items.length > 1 ? (
          <ul className="mt-4 grid grid-cols-5 gap-3" aria-label={`Choose ${videos.length ? "photo or video" : "photo"}`}>
            {items.map((item, i) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-current={i === active ? "true" : undefined}
                  aria-label={
                    item.kind === "video"
                      ? `Play video${item.title ? `: ${item.title}` : ""}`
                      : `Show photo ${i + 1}${item.alt ? `: ${item.alt}` : ""}`
                  }
                  className={cn(
                    "relative block aspect-square w-full overflow-hidden bg-stone-light transition",
                    item.kind === "video" && "bg-charcoal",
                    i === active ? "ring-1 ring-charcoal ring-offset-2 ring-offset-ivory" : "opacity-70 hover:opacity-100",
                  )}
                >
                  {item.kind === "video" ? (
                    <>
                      {item.posterUrl ? <Image src={item.posterUrl} alt="" fill sizes="140px" className="object-cover" /> : null}
                      <PlayBadge size="sm" />
                    </>
                  ) : (
                    <Image src={item.url} alt="" fill sizes="140px" className="object-cover" style={{ objectPosition: `${item.focalX ?? 50}% ${item.focalY ?? 50}%` }} />
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <Lightbox items={items} index={lightbox} onClose={() => setLightbox(null)} onIndex={setLightbox} productName={productName} noun={noun} />
    </div>
  );
}

function Lightbox({
  items,
  index,
  onClose,
  onIndex,
  productName,
  noun,
}: {
  items: Item[];
  index: number | null;
  onClose: () => void;
  onIndex: (i: number) => void;
  productName: string;
  noun: string;
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
      if (e.key === "ArrowRight") onIndex(((index ?? 0) + 1) % items.length);
      if (e.key === "ArrowLeft") onIndex(((index ?? 0) - 1 + items.length) % items.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, items.length, onIndex]);

  const item = index != null ? items[index] : null;
  return (
    <dialog
      ref={ref}
      aria-label={`${productName} ${noun}`}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="on-dark m-0 h-dvh max-h-none w-full max-w-none bg-charcoal/97 p-0 text-ivory backdrop:bg-charcoal/80"
    >
      {item ? (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-5 py-4 text-sm text-ivory/70">
            <span>
              {index! + 1} / {items.length}
            </span>
            <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center text-ivory" aria-label="Close">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                <path d="M5 5l14 14M19 5L5 19" />
              </svg>
            </button>
          </div>
          <div className="relative min-h-0 flex-1">
            {item.kind === "video" ? (
              <Video item={item} productName={productName} autoPlay className="absolute inset-0 bg-transparent" />
            ) : (
              <Image key={item.id} src={item.url} alt={item.alt || productName} fill sizes="100vw" className="animate-fade object-contain" quality={85} />
            )}
          </div>
          {items.length > 1 ? (
            <div className="flex justify-center gap-4 py-4">
              <button
                type="button"
                onClick={() => onIndex((index! - 1 + items.length) % items.length)}
                className="flex h-12 w-12 items-center justify-center border border-ivory/30 hover:border-ivory"
                aria-label={`Previous ${itemLabel(items[(index! - 1 + items.length) % items.length]!)}`}
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => onIndex((index! + 1) % items.length)}
                className="flex h-12 w-12 items-center justify-center border border-ivory/30 hover:border-ivory"
                aria-label={`Next ${itemLabel(items[(index! + 1) % items.length]!)}`}
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
