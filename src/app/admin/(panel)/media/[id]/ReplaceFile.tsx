"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { IMAGE_ACCEPT, MEDIA_MAX_BYTES, precheckImageFile } from "@/lib/media/validate";
import { adminButton, formatBytes } from "@/components/admin/ui";

export const REPLACE_INPUT_ID = "replace-media-file";

/** Upload a new file behind this media item — every location updates at once. */
export function ReplaceFile({ id, usageCount }: { id: string; usageCount: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    if (!file) return;
    const pre = precheckImageFile(file, MEDIA_MAX_BYTES);
    if (pre) {
      setMsg({ ok: false, text: pre });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/admin/media/${id}/replace`, { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: res.status === 401 ? "Your session expired. Please sign in again." : (json.error ?? "The image could not be replaced.") });
        return;
      }
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setMsg({ ok: true, text: "Image replaced everywhere it's used. Check the focal point still suits the new photo." });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error — the image was not replaced. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600">
        Upload a new photo to use in place of this one.{" "}
        {usageCount
          ? `All ${usageCount} location${usageCount === 1 ? "" : "s"} using it will show the new photo immediately.`
          : "It isn't used anywhere yet."}{" "}
        Alt text, caption and focal point are kept.
      </p>
      <div>
        <label htmlFor={REPLACE_INPUT_ID} className="mb-1.5 block text-sm font-medium text-neutral-800">
          New image file
        </label>
        <input
          ref={inputRef}
          id={REPLACE_INPUT_ID}
          type="file"
          accept={IMAGE_ACCEPT}
          onChange={(e) => {
            setMsg(null);
            setFile(e.target.files?.[0] ?? null);
          }}
          className="block w-full text-sm text-neutral-700 file:mr-3 file:h-9 file:rounded file:border file:border-neutral-300 file:bg-white file:px-3 file:text-sm file:font-medium file:text-neutral-800 hover:file:bg-neutral-50"
        />
        <p className="mt-1 text-xs text-neutral-500">JPG, PNG, WebP or AVIF · up to {formatBytes(MEDIA_MAX_BYTES)}</p>
      </div>
      <button type="button" className={adminButton.primary} disabled={!file || busy} onClick={submit}>
        {busy ? "Replacing…" : "Replace image"}
      </button>
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800" : "rounded bg-red-50 px-3 py-2 text-sm text-red-700"}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
