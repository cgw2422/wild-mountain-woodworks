"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/lib/admin/types";
import { MoveButtons, SortableList } from "../Sortable";
import { adminButton } from "../ui";

export type SortableRow = { id: string; label: string; content: React.ReactNode };

/**
 * Reorderable list of server-rendered rows with an explicit "Save order"
 * button. Drag the handle, use the keyboard on the handle, or the arrows.
 */
export function SortableRows({
  rows,
  onSave,
  saveLabel = "Save order",
  hint = "Drag rows (or use the arrows) to change the order, then save.",
}: {
  rows: SortableRow[];
  onSave: (ids: string[]) => Promise<ActionResult>;
  saveLabel?: string;
  hint?: string;
}) {
  // Local order (ids). Row content always comes fresh from the server; rows
  // added/removed on the server are reconciled into the local order.
  const [order, setOrder] = useState<string[]>(() => rows.map((r) => r.id));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = [...order.filter((id) => byId.has(id)), ...rows.filter((r) => !order.includes(r.id)).map((r) => r.id)].map((id) => byId.get(id)!);
  const dirty = items.map((r) => r.id).join(",") !== rows.map((r) => r.id).join(",");
  const setItems = (next: SortableRow[]) => setOrder(next.map((r) => r.id));

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  function save() {
    startTransition(async () => {
      try {
        const res = await onSave(items.map((i) => i.id));
        setMsg({ ok: res.ok, text: res.message ?? (res.ok ? "Order saved." : "Could not save the order.") });
        if (res.ok) router.refresh();
      } catch {
        setMsg({ ok: false, text: "Network error. Please try again." });
      }
    });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">{hint}</p>
        <div className="flex items-center gap-2">
          {dirty ? (
            <button type="button" className={adminButton.ghost} onClick={() => setItems(rows)} disabled={pending}>
              Reset
            </button>
          ) : null}
          <button type="button" className={adminButton.primary} onClick={save} disabled={!dirty || pending}>
            {pending ? "Saving…" : saveLabel}
          </button>
        </div>
      </div>
      <SortableList
        items={items}
        onReorder={setItems}
        className="divide-y divide-neutral-100 overflow-hidden rounded-md border border-neutral-200 bg-white"
        itemClassName="bg-white"
        renderItem={(row, { handle, moveUp, moveDown }) => (
          <div className="flex items-center gap-2 px-2 py-2 sm:px-3">
            {handle}
            <div className="min-w-0 flex-1">{row.content}</div>
            <MoveButtons moveUp={moveUp} moveDown={moveDown} labelUp={`Move ${row.label} up`} labelDown={`Move ${row.label} down`} />
          </div>
        )}
      />
      {msg ? (
        <div role={msg.ok ? "status" : "alert"} className={cn("fixed bottom-5 right-5 z-50 rounded-md px-4 py-3 text-sm text-white shadow-lg", msg.ok ? "bg-neutral-900" : "bg-red-700")}>
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}
