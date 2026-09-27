"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { MediaDTO } from "@/lib/media/dto";
import { IMAGE_ACCEPT, MEDIA_MAX_BYTES, precheckImageFile } from "@/lib/media/validate";
import { Dialog } from "../forms";
import { adminButton, formatBytes } from "../ui";

/* -------------------------------------------------------------------------- */
/* Upload helper with progress                                                 */
/* -------------------------------------------------------------------------- */

export function uploadMedia(
  files: File[],
  onProgress?: (fraction: number) => void,
): Promise<{ items: MediaDTO[]; errors: string[] }> {
  return new Promise((resolve) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/media");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText) as { items?: MediaDTO[]; errors?: string[]; error?: string };
        if (xhr.status === 401) return resolve({ items: [], errors: ["Your session expired. Please sign in again."] });
        resolve({ items: json.items ?? [], errors: json.errors ?? (json.error ? [json.error] : []) });
      } catch {
        resolve({ items: [], errors: ["Upload failed. Please try again."] });
      }
    };
    xhr.onerror = () => resolve({ items: [], errors: ["Network error during upload. Please check your connection and try again."] });
    xhr.send(form);
  });
}

/* -------------------------------------------------------------------------- */
/* Picker dialog                                                               */
/* -------------------------------------------------------------------------- */

export function MediaPickerDialog({
  open,
  onClose,
  onSelect,
  multiple = false,
  title,
  ratioHint,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (items: MediaDTO[]) => void;
  multiple?: boolean;
  title?: string;
  ratioHint?: string;
}) {
  const [tab, setTab] = useState<"library" | "upload">("library");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MediaDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MediaDTO[]>([]);
  const tabsId = useId();

  const load = useCallback(async (q: string, p: number) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/media?q=${encodeURIComponent(q)}&page=${p}&pageSize=40`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { items: MediaDTO[]; total: number };
      setItems((prev) => (p === 1 ? json.items : [...prev, ...json.items]));
      setTotal(json.total);
      setPage(p);
    } catch {
      setLoadError("The media library couldn't be loaded. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    const t = setTimeout(() => void load(query, 1), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [open, query, load]);

  function toggle(item: MediaDTO) {
    if (!multiple) {
      setSelected([item]);
      return;
    }
    setSelected((prev) => (prev.some((p) => p.id === item.id) ? prev.filter((p) => p.id !== item.id) : [...prev, item]));
  }

  function confirm(list = selected) {
    if (!list.length) return;
    onSelect(list);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title ?? (multiple ? "Add images" : "Choose an image")}
      size="xl"
      footer={
        tab === "library" ? (
          <>
            <span className="mr-auto self-center text-sm text-neutral-500">
              {selected.length ? `${selected.length} selected` : ratioHint ? `Displayed at ${ratioHint}. Any size works — it's cropped around the focal point.` : null}
            </span>
            <button type="button" className={adminButton.secondary} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={adminButton.primary} disabled={!selected.length} onClick={() => confirm()}>
              {multiple ? "Add selected" : "Use this image"}
            </button>
          </>
        ) : null
      }
    >
      <div role="tablist" aria-label="Image source" className="mb-4 flex gap-1 border-b border-neutral-200">
        {(
          [
            ["library", "Media library"],
            ["upload", "Upload new"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`${tabsId}-${key}`}
            aria-selected={tab === key}
            aria-controls={`${tabsId}-${key}-panel`}
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              tab === key ? "border-neutral-900 text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "library" ? (
        <div role="tabpanel" id={`${tabsId}-library-panel`} aria-labelledby={`${tabsId}-library`}>
          <label className="sr-only" htmlFor={`${tabsId}-search`}>
            Search media
          </label>
          <input
            id={`${tabsId}-search`}
            type="search"
            placeholder="Search by filename or alt text…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-4 h-10 w-full rounded border border-neutral-300 px-3 text-sm focus:border-neutral-900 focus:outline-none"
          />
          {loadError ? (
            <div className="rounded bg-red-50 p-4 text-sm text-red-700">
              {loadError}{" "}
              <button type="button" className="underline" onClick={() => load(query, 1)}>
                Retry
              </button>
            </div>
          ) : null}
          {!loading && !loadError && items.length === 0 ? (
            <div className="rounded border border-dashed border-neutral-300 px-6 py-12 text-center text-sm text-neutral-600">
              {query ? "No images match your search." : "Your media library is empty."}{" "}
              <button type="button" className="font-medium underline" onClick={() => setTab("upload")}>
                Upload an image
              </button>
            </div>
          ) : null}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" aria-label="Media">
            {items.map((m) => {
              const isSel = selected.some((s) => s.id === m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    aria-pressed={isSel}
                    onClick={() => toggle(m)}
                    onDoubleClick={() => !multiple && confirm([m])}
                    className={cn(
                      "group block w-full overflow-hidden rounded border bg-neutral-50 text-left focus-visible:outline-2 focus-visible:outline-neutral-900",
                      isSel ? "border-neutral-900 ring-2 ring-neutral-900" : "border-neutral-200 hover:border-neutral-400",
                    )}
                  >
                    <span className="relative block aspect-square">
                      <Image src={m.url} alt={m.alt || m.originalName} fill sizes="180px" className="object-cover" />
                      {isSel ? (
                        <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-white">
                          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M3 8l3 3 7-7" />
                          </svg>
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate px-2 py-1.5 text-xs text-neutral-700">{m.originalName}</span>
                    <span className="block px-2 pb-1.5 text-[0.7rem] text-neutral-500">
                      {m.width}×{m.height}
                      {m.usageCount ? ` · used ${m.usageCount}×` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {loading ? <p className="py-6 text-center text-sm text-neutral-500">Loading…</p> : null}
          {!loading && items.length < total ? (
            <div className="mt-4 text-center">
              <button type="button" className={adminButton.secondary} onClick={() => load(query, page + 1)}>
                Load more
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div role="tabpanel" id={`${tabsId}-upload-panel`} aria-labelledby={`${tabsId}-upload`}>
          <UploadDropzone
            multiple={multiple}
            onUploaded={(uploaded) => {
              if (!uploaded.length) return;
              if (multiple) {
                onSelect(uploaded);
                onClose();
              } else confirm([uploaded[0]!]);
            }}
          />
        </div>
      )}
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Dropzone                                                                    */
/* -------------------------------------------------------------------------- */

export function UploadDropzone({
  multiple = true,
  onUploaded,
  compact,
}: {
  multiple?: boolean;
  onUploaded: (items: MediaDTO[]) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const id = useId();

  async function handle(fileList: FileList | File[]) {
    const files = Array.from(fileList).slice(0, multiple ? 30 : 1);
    const pre = files.map((f) => precheckImageFile(f, MEDIA_MAX_BYTES)).filter((e): e is string => Boolean(e));
    const ok = files.filter((f) => !precheckImageFile(f, MEDIA_MAX_BYTES));
    setErrors(pre);
    if (!ok.length) return;
    setProgress(0);
    const res = await uploadMedia(ok, setProgress);
    setProgress(null);
    setErrors((prev) => [...prev, ...res.errors]);
    if (inputRef.current) inputRef.current.value = "";
    onUploaded(res.items);
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) void handle(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center justify-center rounded-md border-2 border-dashed text-center transition",
          compact ? "px-4 py-6" : "px-6 py-14",
          dragging ? "border-neutral-900 bg-neutral-50" : "border-neutral-300 bg-white",
        )}
      >
        <svg viewBox="0 0 24 24" className="mb-3 h-8 w-8 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
        </svg>
        <p className="text-sm text-neutral-700">
          Drag and drop {multiple ? "images" : "an image"} here, or{" "}
          <label htmlFor={id} className="cursor-pointer font-medium text-neutral-900 underline">
            browse
          </label>
        </p>
        <p className="mt-1 text-xs text-neutral-500">JPG, PNG, WebP or AVIF · up to {formatBytes(MEDIA_MAX_BYTES)} each · originals are kept at full quality</p>
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple={multiple}
          className="sr-only"
          onChange={(e) => e.target.files && void handle(e.target.files)}
        />
        {progress != null ? (
          <div className="mt-4 w-full max-w-xs" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
            <div className="h-1.5 overflow-hidden rounded bg-neutral-200">
              <div className="h-full bg-neutral-900 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-neutral-500">{progress < 1 ? "Uploading…" : "Processing…"}</p>
          </div>
        ) : null}
      </div>
      {errors.length ? (
        <ul role="alert" className="mt-3 space-y-1 rounded bg-red-50 p-3 text-sm text-red-700">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
