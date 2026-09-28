"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/admin/types";
import { cn } from "@/lib/cn";
import { MediaPickerDialog } from "@/components/admin/media/MediaPicker";
import { MoveButtons, SortableList } from "@/components/admin/Sortable";
import { Badge, adminButton } from "@/components/admin/ui";

export interface GalleryImage {
  id: string; // media id
  url: string;
  mediaAlt: string;
  alt: string | null; // per-project override
  isPrimary: boolean;
  width: number;
  height: number;
  focalX: number;
  focalY: number;
}

type SavePayload = Array<{ mediaId: string; alt: string | null; isPrimary: boolean }>;

/** Project photo gallery: add from library/upload, reorder, primary, alt override, remove. */
export function GalleryManager({ initial, onSave }: { initial: GalleryImage[]; onSave: (items: SavePayload) => Promise<ActionResult> }) {
  const signature = JSON.stringify(initial);
  const [prevSignature, setPrevSignature] = useState(signature);
  const [items, setItems] = useState(initial);
  if (signature !== prevSignature) {
    setPrevSignature(signature);
    setItems(initial);
  }
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);

  const primaryId = items.find((i) => i.isPrimary)?.id ?? items[0]?.id;
  const dirty = JSON.stringify(items) !== signature;

  function update(id: string, patch: Partial<GalleryImage>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function save() {
    startTransition(async () => {
      try {
        const res = await onSave(items.map((i) => ({ mediaId: i.id, alt: i.alt?.trim() || null, isPrimary: i.id === primaryId })));
        setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Photos saved." : "Something went wrong.") });
        if (res.ok) router.refresh();
      } catch {
        setMsg({ ok: false, text: "Network error — photos not saved." });
      }
    });
  }

  return (
    <div>
      {items.length === 0 ? (
        <div className="rounded border border-dashed border-neutral-300 px-6 py-10 text-center">
          <p className="text-sm text-neutral-600">No photos yet. Add at least one before publishing — the primary photo is used on the Our Work grid and homepage.</p>
          <button type="button" className={cn(adminButton.primary, "mt-4")} onClick={() => setOpen(true)}>
            Add photos
          </button>
        </div>
      ) : (
        <SortableList
          items={items}
          onReorder={setItems}
          layout="grid"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3"
          renderItem={(img, { handle, index, moveUp, moveDown }) => {
            const isPrimary = img.id === primaryId;
            return (
              <div className={cn("overflow-hidden rounded-md border bg-white", isPrimary ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200")}>
                <div className="relative aspect-[4/3] bg-neutral-100">
                  <Image
                    src={img.url}
                    alt={img.alt || img.mediaAlt || ""}
                    fill
                    sizes="(min-width: 1280px) 300px, (min-width: 640px) 45vw, 100vw"
                    className="object-cover"
                    style={{ objectPosition: `${img.focalX}% ${img.focalY}%` }}
                  />
                  <span className="absolute left-2 top-2 flex gap-1">
                    <Badge tone={isPrimary ? "dark" : "neutral"}>{isPrimary ? "Primary" : `#${index + 1}`}</Badge>
                    {!img.alt && !img.mediaAlt ? <Badge tone="amber">No alt</Badge> : null}
                  </span>
                </div>
                <div className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {handle}
                    <MoveButtons moveUp={moveUp} moveDown={moveDown} labelUp={`Move photo ${index + 1} earlier`} labelDown={`Move photo ${index + 1} later`} />
                    <span className="ml-auto flex flex-wrap justify-end gap-1">
                      {!isPrimary ? (
                        <button
                          type="button"
                          className="whitespace-nowrap rounded px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                          onClick={() => setItems((prev) => prev.map((i) => ({ ...i, isPrimary: i.id === img.id })))}
                        >
                          Make primary
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                        onClick={() => setItems((prev) => prev.filter((i) => i.id !== img.id))}
                        aria-label={`Remove photo ${index + 1} from this project`}
                      >
                        Remove
                      </button>
                    </span>
                  </div>
                  <div>
                    <label htmlFor={`alt-${img.id}`} className="mb-1 block text-xs font-medium text-neutral-700">
                      Alt text for this project
                    </label>
                    <input
                      id={`alt-${img.id}`}
                      value={img.alt ?? ""}
                      maxLength={300}
                      onChange={(e) => update(img.id, { alt: e.target.value })}
                      placeholder={img.mediaAlt || "Describe this photo"}
                      className="block h-9 w-full rounded border border-neutral-300 px-2.5 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                    />
                    <p className="mt-1 text-[0.7rem] text-neutral-500">
                      {img.mediaAlt ? "Leave blank to use the library alt text." : "The library image has no alt text."}{" "}
                      <Link href={`/admin/media/${img.id}`} className="underline" target="_blank">
                        Focal point &amp; library details
                      </Link>
                    </p>
                  </div>
                </div>
              </div>
            );
          }}
        />
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {items.length ? (
          <button type="button" className={adminButton.secondary} onClick={() => setOpen(true)}>
            Add photos
          </button>
        ) : null}
        <button type="button" className={adminButton.primary} onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save photos"}
        </button>
        {dirty ? <span className="text-xs font-medium text-amber-700">Unsaved photo changes</span> : null}
        <span className="text-xs text-neutral-500">Drag to reorder. Removing a photo keeps it in the media library.</span>
      </div>

      <MediaPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        multiple
        title="Add project photos"
        onSelect={(picked) =>
          setItems((prev) => [
            ...prev,
            ...picked
              .filter((m) => !prev.some((p) => p.id === m.id))
              .map((m) => ({
                id: m.id,
                url: m.url,
                mediaAlt: m.alt,
                alt: null,
                isPrimary: false,
                width: m.width,
                height: m.height,
                focalX: m.focalX,
                focalY: m.focalY,
              })),
          ])
        }
      />

      {msg ? (
        <div role={msg.ok ? "status" : "alert"} className={cn("fixed bottom-5 right-5 z-50 rounded-md px-4 py-3 text-sm text-white shadow-lg", msg.ok ? "bg-neutral-900" : "bg-red-700")}>
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}
