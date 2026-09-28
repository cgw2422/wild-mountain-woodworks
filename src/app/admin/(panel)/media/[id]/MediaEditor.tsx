"use client";

import Image from "next/image";
import { useId, useRef, useState } from "react";
import type { ActionResult } from "@/lib/admin/types";
import { IMAGE_SLOTS, ratioLabel } from "@/lib/media/slots";
import { ActionForm, SubmitButton, TextArea, TextInput } from "@/components/admin/forms";
import { adminButton } from "@/components/admin/ui";

const PREVIEWS: Array<{ label: string; ratio: number }> = [
  { label: `${IMAGE_SLOTS.hero.label} (desktop)`, ratio: IMAGE_SLOTS.hero.ratio },
  { label: `${IMAGE_SLOTS.hero.label} (phone)`, ratio: IMAGE_SLOTS.hero.mobileRatio },
  { label: IMAGE_SLOTS.banner.label, ratio: IMAGE_SLOTS.banner.ratio },
  { label: IMAGE_SLOTS.productCard.label, ratio: IMAGE_SLOTS.productCard.ratio },
  { label: IMAGE_SLOTS.portfolioCard.label, ratio: IMAGE_SLOTS.portfolioCard.ratio },
  { label: IMAGE_SLOTS.landscape.label, ratio: IMAGE_SLOTS.landscape.ratio },
  { label: IMAGE_SLOTS.square.label, ratio: IMAGE_SLOTS.square.ratio },
  { label: IMAGE_SLOTS.og.label, ratio: IMAGE_SLOTS.og.ratio },
];

const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

/**
 * Alt text, caption and focal point editor. Click/tap or drag on the image to
 * set the focal point, or focus it and use the arrow keys (Shift = 10%).
 */
export function MediaEditor({
  action,
  media,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  media: { url: string; alt: string; caption: string | null; width: number; height: number; focalX: number; focalY: number; blurDataUrl: string | null };
}) {
  const [x, setX] = useState(media.focalX);
  const [y, setY] = useState(media.focalY);
  const [alt, setAlt] = useState(media.alt);
  const dragging = useRef(false);
  const id = useId();

  function setFromPointer(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setX(clamp(((e.clientX - rect.left) / rect.width) * 100));
    setY(clamp(((e.clientY - rect.top) / rect.height) * 100));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (e.key === "Home" || e.key === "c") {
      e.preventDefault();
      setX(50);
      setY(50);
      return;
    }
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setX((v) => clamp(v + m[0]));
    setY((v) => clamp(v + m[1]));
  }

  const position = `${x}% ${y}%`;
  const changed = x !== media.focalX || y !== media.focalY;

  return (
    <ActionForm action={action} className="space-y-6" successMessage="Image details saved — updated everywhere it's used.">
      <section aria-labelledby={`${id}-fp`} className="rounded-md border border-neutral-200 bg-white">
        <header className="border-b border-neutral-100 px-5 py-4">
          <h2 id={`${id}-fp`} className="text-base font-semibold text-neutral-900">
            Focal point
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            Click or tap the most important part of the photo (for example, the table top or the joinery detail). Every crop below keeps that spot in view.
          </p>
        </header>
        <div className="p-5">
          <div className="mx-auto w-fit max-w-full">
            <div
              role="application"
              tabIndex={0}
              aria-label={`Focal point editor. Currently ${x}% from the left and ${y}% from the top.`}
              aria-describedby={`${id}-fp-help`}
              onKeyDown={onKeyDown}
              onPointerDown={(e) => {
                dragging.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                setFromPointer(e);
              }}
              onPointerMove={(e) => {
                if (dragging.current) setFromPointer(e);
              }}
              onPointerUp={() => {
                dragging.current = false;
              }}
              onPointerCancel={() => {
                dragging.current = false;
              }}
              className="relative cursor-crosshair touch-none select-none overflow-hidden rounded bg-neutral-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
            >
              <Image
                src={media.url}
                alt={alt || "Image being edited"}
                width={media.width}
                height={media.height}
                sizes="(min-width: 1024px) 720px, 100vw"
                draggable={false}
                className="block h-auto max-h-[70vh] w-auto max-w-full"
                placeholder={media.blurDataUrl ? "blur" : "empty"}
                blurDataURL={media.blurDataUrl ?? undefined}
                priority
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.6),0_2px_8px_rgba(0,0,0,0.5)]"
                style={{ left: `${x}%`, top: `${y}%` }}
              >
                <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
              </span>
            </div>
          </div>
          <p id={`${id}-fp-help`} className="mt-3 text-center text-xs text-neutral-500">
            Keyboard: focus the image, then use the arrow keys to move the point (hold Shift for bigger steps, Home to re-center).
          </p>
          <div className="mt-4 flex flex-wrap items-end justify-center gap-3">
            <TextInput
              name="focalX"
              label="Horizontal (%)"
              type="number"
              min={0}
              max={100}
              value={x}
              onChange={(e) => setX(clamp(Number(e.target.value) || 0))}
              wrapperClassName="w-32"
            />
            <TextInput
              name="focalY"
              label="Vertical (%)"
              type="number"
              min={0}
              max={100}
              value={y}
              onChange={(e) => setY(clamp(Number(e.target.value) || 0))}
              wrapperClassName="w-32"
            />
            <button
              type="button"
              className={adminButton.ghost}
              onClick={() => {
                setX(50);
                setY(50);
              }}
            >
              Re-center
            </button>
            {changed ? (
              <button
                type="button"
                className={adminButton.ghost}
                onClick={() => {
                  setX(media.focalX);
                  setY(media.focalY);
                }}
              >
                Undo changes
              </button>
            ) : null}
          </div>
          <p className="sr-only" aria-live="polite">
            Focal point {x}% horizontal, {y}% vertical.
          </p>

          <h3 className="mb-3 mt-8 text-sm font-semibold text-neutral-800">How it crops across the site</h3>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {PREVIEWS.map((p) => (
              <li key={p.label}>
                <div className="relative w-full overflow-hidden rounded border border-neutral-200 bg-neutral-100" style={{ aspectRatio: String(p.ratio) }}>
                  <Image src={media.url} alt="" fill sizes="220px" className="object-cover" style={{ objectPosition: position }} />
                </div>
                <p className="mt-1 text-xs text-neutral-600">
                  {p.label} <span className="text-neutral-400">· {ratioLabel(p.ratio)}</span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby={`${id}-desc`} className="rounded-md border border-neutral-200 bg-white">
        <header className="border-b border-neutral-100 px-5 py-4">
          <h2 id={`${id}-desc`} className="text-base font-semibold text-neutral-900">
            Description
          </h2>
        </header>
        <div className="space-y-4 p-5">
          {!alt.trim() ? (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This image has no alt text. Screen-reader users and search engines won&apos;t know what it shows.
            </p>
          ) : null}
          <TextArea
            name="alt"
            label="Alt text"
            rows={2}
            maxLength={300}
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            help={
              <>
                Describe what the photo shows, as you would to someone who can&apos;t see it — e.g. “Walnut live-edge dining table with black steel legs in a bright
                dining room”. Skip “image of”. {alt.length}/300
              </>
            }
          />
          <TextInput name="caption" label="Caption (optional)" defaultValue={media.caption ?? ""} maxLength={500} help="Shown under the image where the design displays captions." />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {changed ? <span className="text-xs font-medium text-amber-700">Focal point changed — save to apply</span> : null}
        <SubmitButton>Save image details</SubmitButton>
      </div>
    </ActionForm>
  );
}
