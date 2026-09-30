"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/admin/types";
import { VIDEO_ACCEPT, VIDEO_MAX_BYTES, precheckVideoFile } from "@/lib/media/validate";
import { ConfirmAction } from "@/components/admin/forms";
import { MoveButtons } from "@/components/admin/Sortable";
import { adminButton, formatBytes } from "@/components/admin/ui";

export type VideoRow = {
  id: string;
  url: string;
  title: string;
  originalName: string;
  size: number;
  width: number;
  height: number;
  durationSec: number;
  posterUrl: string | null;
};

export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const UNPLAYABLE =
  "This browser can't play that video, so customers probably can't either. Export it as MP4 (H.264) — on an iPhone, set Camera → Formats → Most Compatible, or use Share → Options → Most Compatible — and try again.";

/**
 * Load the file in a hidden <video>, read its size and length, and capture a
 * frame (about 1 s in) as the poster image. This also proves the browser can
 * decode the file before anything is uploaded.
 */
function probeVideo(file: File): Promise<{ width: number; height: number; duration: number; poster: Blob | null }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error(UNPLAYABLE))), 20000);
    video.onerror = () => done(() => reject(new Error(UNPLAYABLE)));
    let measuring = false;
    const seekToFrame = () => {
      measuring = false;
      video.currentTime = Math.min(1, video.duration / 4);
    };
    video.onloadedmetadata = () => {
      if (!video.videoWidth || !video.videoHeight) return done(() => reject(new Error(UNPLAYABLE)));
      if (Number.isFinite(video.duration) && video.duration > 0) return seekToFrame();
      // Some recordings (browser/screen-recorder WebM) don't store their length;
      // seeking far past the end makes the browser work it out.
      measuring = true;
      video.currentTime = 1e7;
    };
    video.ondurationchange = () => {
      if (measuring && Number.isFinite(video.duration) && video.duration > 0) seekToFrame();
    };
    video.onseeked = () => {
      if (measuring) {
        if (Number.isFinite(video.duration) && video.duration > 0) seekToFrame();
        return;
      }
      const scale = Math.min(1, 1600 / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const meta = { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
      try {
        canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => done(() => resolve({ ...meta, poster: blob })), "image/jpeg", 0.85);
      } catch {
        done(() => resolve({ ...meta, poster: null }));
      }
    };
    video.src = url;
  });
}

function upload(productId: string, form: FormData, onProgress: (f: number) => void): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/admin/products/${productId}/videos`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText) as { error?: string };
        if (xhr.status === 401) return resolve({ ok: false, error: "Your session expired. Please sign in again." });
        resolve(xhr.status < 300 ? { ok: true } : { ok: false, error: json.error ?? "Upload failed." });
      } catch {
        resolve({
          ok: false,
          error: xhr.status === 413 ? "The video was too large for the server." : `Upload failed (server error ${xhr.status}). Please try again.`,
        });
      }
    };
    xhr.onerror = () => resolve({ ok: false, error: "Network error during upload. Please check your connection and try again." });
    xhr.send(form);
  });
}

/**
 * Product videos: upload (with a progress bar), title, order and removal.
 * Changes are saved immediately. Videos appear in the product gallery after
 * the photos.
 */
export function VideosManager({
  productId,
  initial,
  saveTitle,
  reorder,
  remove,
}: {
  productId: string;
  initial: VideoRow[];
  saveTitle: (videoId: string, title: string) => Promise<ActionResult>;
  reorder: (ids: string[]) => Promise<ActionResult>;
  remove: (videoId: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState(initial);
  const [syncedFrom, setSyncedFrom] = useState(initial);
  const [busy, setBusy] = useState<null | { stage: "checking" | "uploading"; progress: number; name: string }>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [, startTransition] = useTransition();

  // Pick up server changes after router.refresh().
  if (initial !== syncedFrom) {
    setSyncedFrom(initial);
    setRows(initial);
  }

  async function onFile(file: File) {
    setMessage(null);
    const pre = precheckVideoFile(file);
    if (pre) return setMessage({ ok: false, text: pre });
    setBusy({ stage: "checking", progress: 0, name: file.name });
    let probe: Awaited<ReturnType<typeof probeVideo>>;
    try {
      probe = await probeVideo(file);
    } catch (err) {
      setBusy(null);
      return setMessage({ ok: false, text: (err as Error).message });
    }
    const form = new FormData();
    form.append("video", file);
    if (probe.poster) form.append("poster", new File([probe.poster], file.name.replace(/\.[^.]+$/, "") + "-poster.jpg", { type: "image/jpeg" }));
    form.append("width", String(probe.width));
    form.append("height", String(probe.height));
    form.append("duration", String(probe.duration));
    setBusy({ stage: "uploading", progress: 0, name: file.name });
    const res = await upload(productId, form, (progress) => setBusy({ stage: "uploading", progress, name: file.name }));
    setBusy(null);
    if (!res.ok) return setMessage({ ok: false, text: res.error ?? "Upload failed." });
    setMessage({ ok: true, text: "Video uploaded. It now appears in the product gallery after the photos." });
    router.refresh();
  }

  function run(action: () => Promise<ActionResult>, optimistic?: VideoRow[]) {
    const before = rows;
    if (optimistic) setRows(optimistic);
    startTransition(async () => {
      try {
        const res = await action();
        if (!res.ok) {
          setRows(before);
          setMessage({ ok: false, text: res.message ?? "Something went wrong." });
        } else router.refresh();
      } catch {
        setRows(before);
        setMessage({ ok: false, text: "Network error. Please try again." });
      }
    });
  }

  function move(from: number, to: number) {
    const next = [...rows];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    run(() => reorder(next.map((r) => r.id)), next);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-neutral-600">
          MP4 (H.264) plays in every browser. Up to {Math.round(VIDEO_MAX_BYTES / 1024 / 1024)} MB — 1080p clips under a minute or two work best. A thumbnail frame is captured
          automatically.
        </p>
        <button type="button" className={adminButton.primary} disabled={Boolean(busy)} onClick={() => inputRef.current?.click()}>
          Upload video
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={VIDEO_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a video to upload"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void onFile(file);
          }}
        />
      </div>

      {busy ? (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm" role="status" aria-live="polite">
          <p className="truncate">
            {busy.stage === "checking" ? "Checking" : "Uploading"} {busy.name}
            {busy.stage === "uploading" ? ` — ${Math.round(busy.progress * 100)}%` : "…"}
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-neutral-200">
            <div className="h-full bg-neutral-900 transition-[width]" style={{ width: `${busy.stage === "checking" ? 5 : Math.max(5, busy.progress * 100)}%` }} />
          </div>
        </div>
      ) : null}

      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "rounded bg-green-50 px-3 py-2 text-sm text-green-900" : "rounded bg-red-50 px-3 py-2 text-sm text-red-800"}>
          {message.text}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">No videos yet.</p>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded border border-neutral-200">
          {rows.map((v, i) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 p-3">
              <a href={v.url} target="_blank" rel="noreferrer" className="relative block h-16 w-28 shrink-0 overflow-hidden rounded bg-neutral-900" title="Open the video in a new tab">
                {v.posterUrl ? <Image src={v.posterUrl} alt="" fill sizes="112px" className="object-cover" /> : null}
                <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-lg text-white drop-shadow">
                  ▶
                </span>
                <span className="sr-only">Play {v.title || v.originalName}</span>
              </a>
              <div className="min-w-[12rem] flex-1">
                <label className="sr-only" htmlFor={`video-title-${v.id}`}>
                  Video title
                </label>
                <input
                  id={`video-title-${v.id}`}
                  defaultValue={v.title}
                  maxLength={200}
                  placeholder="Title (optional — describes the video for screen readers and search)"
                  className="block h-9 w-full rounded border border-neutral-300 px-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value !== v.title) run(() => saveTitle(v.id, value), rows.map((r) => (r.id === v.id ? { ...r, title: value } : r)));
                  }}
                />
                <p className="mt-1 text-xs text-neutral-500">
                  {formatDuration(v.durationSec)} · {v.width}×{v.height} · {formatBytes(v.size)} · {v.originalName}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <MoveButtons moveUp={i > 0 ? () => move(i, i - 1) : undefined} moveDown={i < rows.length - 1 ? () => move(i, i + 1) : undefined} />
                <ConfirmAction
                  action={() => remove(v.id)}
                  label="Remove"
                  variant="small"
                  title="Remove this video?"
                  body="It's removed from this product's gallery and the file is deleted (unless a duplicated product still uses it)."
                  confirmLabel="Remove video"
                  successMessage="Video removed."
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
