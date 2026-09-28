"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/admin/types";
import { cn } from "@/lib/cn";
import { MoveButtons, SortableList } from "@/components/admin/Sortable";
import { Badge, StatusBadge, formatDate } from "@/components/admin/ui";

export interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  featured: boolean;
  isSample: boolean;
  imageCount: number;
  updatedAt: string;
  image: { url: string; focalX: number; focalY: number } | null;
}

/** Drag-reorderable project list; the new order saves automatically. */
export function PortfolioList({ projects, onReorder }: { projects: ProjectRow[]; onReorder: (ids: string[]) => Promise<ActionResult> }) {
  const signature = projects.map((p) => `${p.id}:${p.updatedAt}`).join(",");
  const [prevSignature, setPrevSignature] = useState(signature);
  const [items, setItems] = useState(projects);
  if (signature !== prevSignature) {
    setPrevSignature(signature);
    setItems(projects);
  }
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  function reorder(next: ProjectRow[]) {
    const previous = items;
    setItems(next);
    startTransition(async () => {
      try {
        const res = await onReorder(next.map((p) => p.id));
        if (!res.ok) {
          setItems(previous);
          setMsg({ ok: false, text: res.message ?? "The new order couldn't be saved." });
        } else setMsg({ ok: true, text: "Order saved." });
      } catch {
        setItems(previous);
        setMsg({ ok: false, text: "Network error — order not saved." });
      }
    });
  }

  return (
    <>
      <SortableList
        items={items}
        onReorder={reorder}
        className="divide-y divide-neutral-100 overflow-hidden rounded-md border border-neutral-200 bg-white"
        renderItem={(p, { handle, moveUp, moveDown }) => (
          <div className={cn("flex items-center gap-3 px-2 py-2.5 sm:px-3", pending && "opacity-80")}>
            {handle}
            <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded bg-neutral-100">
              {p.image ? (
                <Image src={p.image.url} alt="" fill sizes="56px" className="object-cover" style={{ objectPosition: `${p.image.focalX}% ${p.image.focalY}%` }} />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-[0.6rem] text-neutral-400">No photo</span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <Link href={`/admin/portfolio/${p.id}`} className="block truncate py-1 text-sm font-medium text-neutral-900 hover:underline">
                {p.name}
              </Link>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                <StatusBadge status={p.status} />
                {p.featured ? <Badge tone="blue">Featured on homepage</Badge> : null}
                {p.isSample ? <Badge tone="violet">Sample</Badge> : null}
                <span>
                  {p.imageCount} photo{p.imageCount === 1 ? "" : "s"} · Updated {formatDate(p.updatedAt)}
                </span>
              </span>
            </span>
            <MoveButtons moveUp={moveUp} moveDown={moveDown} labelUp={`Move ${p.name} up`} labelDown={`Move ${p.name} down`} />
            <Link href={`/admin/portfolio/${p.id}`} className="hidden text-sm font-medium text-neutral-900 underline sm:inline">
              Edit<span className="sr-only"> {p.name}</span>
            </Link>
          </div>
        )}
      />
      {msg ? (
        <div role={msg.ok ? "status" : "alert"} className={cn("fixed bottom-5 right-5 z-50 rounded-md px-4 py-3 text-sm text-white shadow-lg", msg.ok ? "bg-neutral-900" : "bg-red-700")}>
          {msg.text}
        </div>
      ) : null}
    </>
  );
}
