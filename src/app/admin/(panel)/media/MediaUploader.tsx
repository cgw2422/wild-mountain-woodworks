"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MediaDTO } from "@/lib/media/dto";
import { UploadDropzone } from "@/components/admin/media/MediaPicker";

/** Library upload area: refreshes the grid and nudges for alt text. */
export function MediaUploader() {
  const router = useRouter();
  const [uploaded, setUploaded] = useState<MediaDTO[]>([]);
  return (
    <div>
      <UploadDropzone
        multiple
        compact
        onUploaded={(items) => {
          if (!items.length) return;
          setUploaded(items);
          router.refresh();
        }}
      />
      {uploaded.length ? (
        <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <span>
            {uploaded.length} image{uploaded.length === 1 ? "" : "s"} uploaded. Add descriptive alt text so every photo is accessible and search-friendly:{" "}
            {uploaded.slice(0, 5).map((m, i) => (
              <span key={m.id}>
                {i ? ", " : ""}
                <Link href={`/admin/media/${m.id}`} className="font-medium underline">
                  {m.originalName}
                </Link>
              </span>
            ))}
            {uploaded.length > 5 ? ` and ${uploaded.length - 5} more (use the “Missing alt text” filter)` : ""}
          </span>
          <button type="button" onClick={() => setUploaded([])} className="text-xs font-medium underline">
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
