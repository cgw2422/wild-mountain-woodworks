"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/admin/types";
import { cn } from "@/lib/cn";
import { MoveButtons, SortableList } from "@/components/admin/Sortable";
import { adminButton } from "@/components/admin/ui";
import type { PickerOption } from "./types";

/**
 * Choose and order a subset of records (e.g. featured products on the
 * homepage): searchable add, remove, drag/keyboard reorder, explicit save.
 */
export function OrderedPicker({
  options,
  selectedIds,
  onSave,
  noun,
  emptyText,
  max,
}: {
  options: PickerOption[];
  selectedIds: string[];
  onSave: (ids: string[]) => Promise<ActionResult>;
  noun: { singular: string; plural: string };
  emptyText: string;
  max?: number;
}) {
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const signature = selectedIds.join(",");
  const [prevSignature, setPrevSignature] = useState(signature);
  const [ids, setIds] = useState<string[]>(selectedIds.filter((id) => byId.has(id)));
  if (signature !== prevSignature) {
    setPrevSignature(signature);
    setIds(selectedIds.filter((id) => byId.has(id)));
  }
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const searchId = useId();

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);

  const dirty = ids.join(",") !== selectedIds.filter((id) => byId.has(id)).join(",");
  const atMax = max != null && ids.length >= max;
  const q = query.trim().toLowerCase();
  const available = options.filter((o) => !ids.includes(o.id) && (!q || o.name.toLowerCase().includes(q) || o.detail?.toLowerCase().includes(q)));
  const selected = ids.map((id) => byId.get(id)!).filter(Boolean);

  function save() {
    startTransition(async () => {
      try {
        const res = await onSave(ids);
        setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Saved — live on the homepage now." : "Something went wrong.") });
        if (res.ok) router.refresh();
      } catch {
        setMsg({ ok: false, text: "Network error — not saved. Please try again." });
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="min-w-0">
        <h3 className="mb-2 text-sm font-semibold text-neutral-800">
          Shown on the homepage <span className="font-normal text-neutral-500">({ids.length}{max ? ` of ${max} max` : ""})</span>
        </h3>
        {selected.length === 0 ? (
          <p className="rounded border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">{emptyText}</p>
        ) : (
          <SortableList
            items={selected}
            onReorder={(list) => setIds(list.map((i) => i.id))}
            className="space-y-2"
            renderItem={(o, { handle, index, moveUp, moveDown }) => (
              <div className="flex items-center gap-2 rounded border border-neutral-200 bg-white p-2">
                {handle}
                <span className="w-5 text-center text-xs tabular-nums text-neutral-500">{index + 1}</span>
                <Thumb option={o} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-neutral-900">{o.name}</span>
                  {o.detail ? <span className="block truncate text-xs text-neutral-500">{o.detail}</span> : null}
                </span>
                <MoveButtons moveUp={moveUp} moveDown={moveDown} labelUp={`Move ${o.name} up`} labelDown={`Move ${o.name} down`} />
                <button
                  type="button"
                  onClick={() => setIds((prev) => prev.filter((id) => id !== o.id))}
                  className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  aria-label={`Remove ${o.name} from the homepage`}
                >
                  Remove
                </button>
              </div>
            )}
          />
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className={adminButton.primary} disabled={pending || !dirty} onClick={save}>
            {pending ? "Saving…" : `Save featured ${noun.plural}`}
          </button>
          {dirty ? <span className="text-xs font-medium text-amber-700">Unsaved changes</span> : null}
        </div>
      </div>

      <div className="min-w-0">
        <label htmlFor={searchId} className="mb-2 block text-sm font-semibold text-neutral-800">
          Add {noun.plural}
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${noun.plural}…`}
          className="mb-2 h-10 w-full rounded border border-neutral-300 px-3 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
        />
        {options.length === 0 ? (
          <p className="text-sm text-neutral-500">There are no {noun.plural} available to feature yet.</p>
        ) : available.length === 0 ? (
          <p className="text-sm text-neutral-500">{q ? `No ${noun.plural} match “${query}”.` : `Every ${noun.singular} is already featured.`}</p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto rounded border border-neutral-200 bg-white p-1" aria-label={`Available ${noun.plural}`}>
            {available.map((o) => (
              <li key={o.id} className="flex items-center gap-2 rounded p-1.5 hover:bg-neutral-50">
                <Thumb option={o} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-neutral-900">{o.name}</span>
                  {o.detail ? <span className="block truncate text-xs text-neutral-500">{o.detail}</span> : null}
                </span>
                {o.href ? (
                  <Link href={o.href} className="hidden text-xs text-neutral-500 underline hover:text-neutral-900 sm:inline">
                    Edit<span className="sr-only"> {o.name}</span>
                  </Link>
                ) : null}
                <button
                  type="button"
                  disabled={atMax}
                  onClick={() => setIds((prev) => [...prev, o.id])}
                  className={cn(adminButton.small)}
                  aria-label={`Add ${o.name} to the homepage`}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
        {atMax ? <p className="mt-2 text-xs text-neutral-500">Maximum of {max} reached — remove one to add another.</p> : null}
      </div>

      {msg ? (
        <div role={msg.ok ? "status" : "alert"} className={cn("fixed bottom-5 right-5 z-50 rounded-md px-4 py-3 text-sm text-white shadow-lg", msg.ok ? "bg-neutral-900" : "bg-red-700")}>
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}

function Thumb({ option }: { option: PickerOption }) {
  return (
    <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded bg-neutral-100">
      {option.image ? (
        <Image
          src={option.image.url}
          alt=""
          fill
          sizes="40px"
          className="object-cover"
          style={{ objectPosition: `${option.image.focalX}% ${option.image.focalY}%` }}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[0.6rem] text-neutral-400">No img</span>
      )}
    </span>
  );
}
