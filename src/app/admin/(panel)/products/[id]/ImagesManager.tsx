"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/lib/admin/types";
import type { MediaDTO } from "@/lib/media/dto";
import { IMAGE_SLOTS, ratioLabel } from "@/lib/media/slots";
import { IMAGE_ACCEPT } from "@/lib/media/validate";
import { Dialog } from "@/components/admin/forms";
import { MoveButtons, SortableList } from "@/components/admin/Sortable";
import { Badge, adminButton } from "@/components/admin/ui";
import { MediaPickerDialog } from "@/components/admin/media/MediaPicker";
import type { ImageState } from "../_lib/payloads";

export type GalleryMedia = { url: string; alt: string; width: number; height: number; focalX: number; focalY: number; originalName: string };
export type GalleryItem = { id: string; alt: string; isPrimary: boolean; media: GalleryMedia };

const CARD_RATIO = IMAGE_SLOTS.productCard.ratio;

function normalize(items: GalleryItem[]): GalleryItem[] {
  if (!items.length) return items;
  const primary = items.findIndex((i) => i.isPrimary);
  const idx = primary < 0 ? 0 : primary;
  return items.map((i, n) => (i.isPrimary === (n === idx) ? i : { ...i, isPrimary: n === idx }));
}

/**
 * Product gallery manager. Every change (add, reorder, primary, alt text,
 * remove) is saved immediately via `save`, which replaces the product's
 * image list in one transaction. Removing never deletes the Media item.
 */
export function ImagesManager({ initial, save }: { initial: GalleryItem[]; save: (images: ImageState[]) => Promise<ActionResult> }) {
  const [items, setItems] = useState<GalleryItem[]>(() => normalize(initial));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [replaceFor, setReplaceFor] = useState<GalleryItem | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; text?: string }>({ kind: "idle" });
  const [, startTransition] = useTransition();
  const router = useRouter();
  const saveSeq = useRef(0);

  useEffect(() => {
    if (status.kind !== "saved") return;
    const t = setTimeout(() => setStatus({ kind: "idle" }), 2500);
    return () => clearTimeout(t);
  }, [status]);

  function persist(next: GalleryItem[]) {
    const normalized = normalize(next);
    setItems(normalized);
    const seq = ++saveSeq.current;
    setStatus({ kind: "saving" });
    startTransition(async () => {
      try {
        const res = await save(normalized.map((i) => ({ mediaId: i.id, alt: i.alt, isPrimary: i.isPrimary })));
        if (seq !== saveSeq.current) return; // a newer save is in flight
        if (!res.ok) setStatus({ kind: "error", text: res.message ?? "Images could not be saved." });
        else {
          setStatus({ kind: "saved", text: res.message ?? "Images saved." });
          router.refresh();
        }
      } catch {
        if (seq === saveSeq.current) setStatus({ kind: "error", text: "Network error — images were not saved." });
      }
    });
  }

  function add(selected: MediaDTO[]) {
    const existing = new Set(items.map((i) => i.id));
    const fresh = selected.filter((m) => !existing.has(m.id));
    if (!fresh.length) {
      setStatus({ kind: "error", text: "Those images are already in this gallery." });
      return;
    }
    persist([
      ...items,
      ...fresh.map((m) => ({
        id: m.id,
        alt: "",
        isPrimary: false,
        media: { url: m.url, alt: m.alt, width: m.width, height: m.height, focalX: m.focalX, focalY: m.focalY, originalName: m.originalName },
      })),
    ]);
  }

  function update(id: string, patch: Partial<GalleryItem>, save = true) {
    const next = items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    if (save) persist(next);
    else setItems(next);
  }

  function makePrimary(id: string) {
    persist(items.map((i) => ({ ...i, isPrimary: i.id === id })));
  }

  return (
    // Enter in an alt-text field must not submit the surrounding product form.
    <div
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-600">
          Thumbnails show the product card crop ({ratioLabel(CARD_RATIO)}). Drag to reorder. Changes save automatically.
        </p>
        <div className="flex items-center gap-3">
          <SaveStatus status={status} onRetry={() => persist(items)} />
          <button type="button" className={adminButton.primary} onClick={() => setPickerOpen(true)}>
            Add images
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-300 px-6 py-10 text-center">
          <p className="text-sm font-medium text-neutral-900">No images yet</p>
          <p className="mt-1 text-sm text-neutral-500">Upload new photos or choose from the media library. At least one image is required to publish.</p>
          <button type="button" className={cn(adminButton.secondary, "mt-4")} onClick={() => setPickerOpen(true)}>
            Add images
          </button>
        </div>
      ) : (
        <SortableList
          items={items}
          onReorder={persist}
          layout="grid"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
          itemClassName="rounded-md border border-neutral-200 bg-white"
          renderItem={(item, { handle, index, moveUp, moveDown }) => (
            <ImageTile
              item={item}
              index={index}
              handle={handle}
              moveUp={moveUp}
              moveDown={moveDown}
              onAltChange={(alt) => update(item.id, { alt }, false)}
              onAltCommit={() => persist(items)}
              onPrimary={() => makePrimary(item.id)}
              onRemove={() => persist(items.filter((i) => i.id !== item.id))}
              onReplace={() => setReplaceFor(item)}
            />
          )}
        />
      )}

      <MediaPickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} multiple onSelect={add} ratioHint={ratioLabel(CARD_RATIO)} title="Add product images" />
      <ReplaceDialog
        item={replaceFor}
        onClose={() => setReplaceFor(null)}
        onReplaced={(id, media) => {
          setItems((prev) => prev.map((i) => (i.id === id ? { ...i, media } : i)));
          setStatus({ kind: "saved", text: "File replaced everywhere it's used." });
          router.refresh();
        }}
      />
    </div>
  );
}

function SaveStatus({ status, onRetry }: { status: { kind: string; text?: string }; onRetry: () => void }) {
  if (status.kind === "idle") return null;
  return (
    <span role={status.kind === "error" ? "alert" : "status"} className={cn("text-xs", status.kind === "error" ? "text-red-700" : "text-neutral-500")}>
      {status.kind === "saving" ? "Saving…" : status.text}
      {status.kind === "error" ? (
        <button type="button" className="ml-2 font-medium underline" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </span>
  );
}

function ImageTile({
  item,
  index,
  handle,
  moveUp,
  moveDown,
  onAltChange,
  onAltCommit,
  onPrimary,
  onRemove,
  onReplace,
}: {
  item: GalleryItem;
  index: number;
  handle: React.ReactNode;
  moveUp?: () => void;
  moveDown?: () => void;
  onAltChange: (alt: string) => void;
  onAltCommit: () => void;
  onPrimary: () => void;
  onRemove: () => void;
  onReplace: () => void;
}) {
  const [initialAlt] = useState(item.alt);
  const lastCommitted = useRef(initialAlt);
  const effectiveAlt = item.alt.trim() || item.media.alt;
  const label = `image ${index + 1}${item.media.originalName ? ` (${item.media.originalName})` : ""}`;
  return (
    <div className="flex h-full flex-col">
      <div className="relative overflow-hidden rounded-t-md bg-neutral-100" style={{ aspectRatio: String(CARD_RATIO) }}>
        <Image
          src={item.media.url}
          alt={effectiveAlt || ""}
          fill
          sizes="(min-width: 1280px) 220px, (min-width: 640px) 30vw, 45vw"
          className="object-cover"
          style={{ objectPosition: `${item.media.focalX}% ${item.media.focalY}%` }}
        />
        <div className="absolute left-1.5 top-1.5 flex gap-1">
          {item.isPrimary ? <Badge tone="dark">Primary</Badge> : null}
          <span className="rounded bg-white/90 px-1.5 text-xs font-medium tabular-nums text-neutral-700">{index + 1}</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2">
        <div className="flex items-center justify-between">
          {handle}
          <MoveButtons moveUp={moveUp} moveDown={moveDown} labelUp={`Move ${label} earlier`} labelDown={`Move ${label} later`} />
        </div>
        <div>
          <label htmlFor={`alt-${item.id}`} className="mb-1 block text-xs font-medium text-neutral-700">
            Alt text (this product)
          </label>
          <input
            id={`alt-${item.id}`}
            value={item.alt}
            onChange={(e) => onAltChange(e.target.value)}
            onBlur={() => {
              if (item.alt !== lastCommitted.current) {
                lastCommitted.current = item.alt;
                onAltCommit();
              }
            }}
            maxLength={300}
            placeholder={item.media.alt || "Describe the photo"}
            className="block h-8 w-full rounded border border-neutral-300 bg-white px-2 text-xs focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
          />
          <p className="mt-0.5 text-[0.7rem] text-neutral-500">
            {item.alt.trim() ? "Overrides the library alt text." : item.media.alt ? "Using the library alt text." : <span className="text-amber-700">Missing alt text</span>}
          </p>
        </div>
        <div className="mt-auto flex flex-wrap gap-1.5">
          {!item.isPrimary ? (
            <button type="button" className={adminButton.small} onClick={onPrimary} aria-label={`Make ${label} primary`}>
              Make primary
            </button>
          ) : null}
          <button type="button" className={adminButton.small} onClick={onReplace} aria-label={`Replace file for ${label}`}>
            Replace file
          </button>
          <button type="button" className={cn(adminButton.small, "text-red-700")} onClick={onRemove} aria-label={`Remove ${label} from this product`}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

function ReplaceDialog({
  item,
  onClose,
  onReplaced,
}: {
  item: GalleryItem | null;
  onClose: () => void;
  onReplaced: (mediaId: string, media: GalleryMedia) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/admin/media/${item.id}/replace`, { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { item?: MediaDTO; error?: string };
      if (!res.ok || !json.item) {
        setError(res.status === 401 ? "Your session expired. Please sign in again." : (json.error ?? "The image could not be replaced."));
        return;
      }
      const m = json.item;
      onReplaced(item.id, { url: m.url, alt: m.alt, width: m.width, height: m.height, focalX: m.focalX, focalY: m.focalY, originalName: m.originalName });
      onClose();
    } catch {
      setError("Network error — the file was not replaced.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Dialog
      open={item !== null}
      onClose={() => {
        if (!busy) {
          setError(null);
          onClose();
        }
      }}
      title="Replace image file"
      size="sm"
      footer={
        <>
          <button type="button" className={adminButton.secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={adminButton.primary} onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? "Uploading…" : "Choose new file"}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-neutral-700">
        <p>
          <strong>This replaces the file everywhere this image is used</strong> — on this product and on any other product, page or section that uses the same media item. Alt text and focal point are kept.
        </p>
        <p>
          To use a different photo on this product only, remove this image and add another one instead.
          {item ? (
            <>
              {" "}
              <Link href={`/admin/media/${item.id}`} target="_blank" className="underline">
                See where it&apos;s used ↗
              </Link>
            </>
          ) : null}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        {error ? (
          <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
