import { formatBytes } from "@/components/admin/ui";

export type AttachmentView = { id: string; filename: string; size: number; width: number | null; height: number | null };

/**
 * Customer reference images. Served only to signed-in admins through
 * /api/admin/attachments/[id] (never from a public URL).
 */
export function AttachmentsGrid({ attachments }: { attachments: AttachmentView[] }) {
  if (attachments.length === 0) return <p className="text-sm text-neutral-500">No reference images were attached.</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {attachments.map((a) => {
        const src = `/api/admin/attachments/${a.id}`;
        return (
          <li key={a.id}>
            <a
              href={src}
              target="_blank"
              rel="noopener"
              className="group block overflow-hidden rounded border border-neutral-200 bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
            >
              {/* Private, cookie-authenticated image: bypass the public image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`Customer reference image: ${a.filename}`}
                loading="lazy"
                width={a.width ?? undefined}
                height={a.height ?? undefined}
                className="aspect-square h-auto w-full object-cover transition group-hover:opacity-90"
              />
              <span className="sr-only">(opens full size in a new tab)</span>
            </a>
            <p className="mt-1 truncate text-xs text-neutral-600" title={a.filename}>
              {a.filename}
            </p>
            <p className="text-xs text-neutral-400">
              {formatBytes(a.size)}
              {a.width && a.height ? ` · ${a.width}×${a.height}` : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
