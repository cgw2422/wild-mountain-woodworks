"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import type { MediaDTO } from "@/lib/media/dto";
import { IMAGE_SLOTS, ratioLabel, type ImageSlot } from "@/lib/media/slots";
import { useAdminForm } from "../forms";
import { adminButton } from "../ui";
import { MediaPickerDialog } from "./MediaPicker";

export type ImageValue = Pick<MediaDTO, "id" | "url" | "alt" | "width" | "height" | "focalX" | "focalY"> & {
  originalName?: string;
};

/**
 * Shows the currently assigned image for a design location with
 * CHANGE IMAGE (upload new or choose from the media library) and REMOVE.
 * Submits the selected media id in a hidden input named `name`.
 */
export function ImageField({
  name,
  label,
  value: initial,
  slot,
  help,
  onChange,
  className,
  compact,
}: {
  name: string;
  label: string;
  value: ImageValue | null;
  slot: ImageSlot;
  help?: string;
  onChange?: (value: ImageValue | null) => void;
  className?: string;
  compact?: boolean;
}) {
  const [value, setValue] = useState<ImageValue | null>(initial);
  const [open, setOpen] = useState(false);
  const { fieldErrors } = useAdminForm();
  const def = IMAGE_SLOTS[slot];
  const ratio = ratioLabel(def.ratio);

  function set(v: ImageValue | null) {
    setValue(v);
    onChange?.(v);
  }

  return (
    <div className={className}>
      <p className="mb-1.5 text-sm font-medium text-neutral-800">{label}</p>
      <input type="hidden" name={name} value={value?.id ?? ""} />
      <div className={cn("flex gap-4", compact ? "items-center" : "flex-col sm:flex-row sm:items-start")}>
        <div
          className={cn("relative shrink-0 overflow-hidden rounded border border-neutral-200 bg-neutral-100", compact ? "w-28" : "w-full sm:w-64")}
          style={{ aspectRatio: String(def.ratio) }}
        >
          {value ? (
            <Image
              src={value.url}
              alt={value.alt || "Selected image"}
              fill
              sizes="256px"
              className="object-cover"
              style={{ objectPosition: `${value.focalX}% ${value.focalY}%` }}
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-neutral-500">No image</span>
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={adminButton.secondary} onClick={() => setOpen(true)}>
              {value ? "Change image" : "Add image"}
            </button>
            {value ? (
              <button type="button" className={adminButton.ghost} onClick={() => set(null)}>
                Remove
              </button>
            ) : null}
          </div>
          <p className="text-xs text-neutral-500">
            {def.label} · displayed at {ratio}
            {value ? ` · original ${value.width}×${value.height}` : ""}
          </p>
          {help ? <p className="text-xs text-neutral-500">{help}</p> : null}
          {value ? (
            <p className="text-xs">
              <Link href={`/admin/media/${value.id}`} className="text-neutral-700 underline hover:text-neutral-900" target="_blank">
                Edit alt text &amp; focal point
              </Link>
              {!value.alt ? <span className="ml-2 text-amber-700">Missing alt text</span> : null}
            </p>
          ) : null}
          {fieldErrors[name] ? <p className="text-xs font-medium text-red-600">{fieldErrors[name]}</p> : null}
        </div>
      </div>
      <MediaPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        ratioHint={ratio}
        onSelect={(items) => {
          const m = items[0];
          if (m) set(m);
        }}
      />
    </div>
  );
}
