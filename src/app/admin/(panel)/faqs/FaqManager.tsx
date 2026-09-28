"use client";

import { useEffect, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/admin/types";
import { cn } from "@/lib/cn";
import { ActionButton, ActionForm, ConfirmAction, Dialog, Select, SubmitButton, TextInput, Toggle } from "@/components/admin/forms";
import { MarkdownEditor } from "@/components/admin/content/MarkdownEditor";
import { MoveButtons, SortableList } from "@/components/admin/Sortable";
import { Badge, EmptyState, adminButton } from "@/components/admin/ui";
import {
  createFaqCategory,
  deleteFaq,
  deleteFaqCategory,
  renameFaqCategory,
  reorderFaqCategories,
  reorderFaqs,
  saveFaq,
  setFaqArchived,
} from "./actions";

export interface FaqCategoryRow {
  id: string;
  name: string;
  count: number;
}
export interface FaqRow {
  id: string;
  question: string;
  answer: string;
  categoryId: string | null;
  visible: boolean;
  showOnProductPages: boolean;
  archived: boolean;
}

/* -------------------------------------------------------------------------- */

function useToast() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3000);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div role={msg.ok ? "status" : "alert"} className={cn("fixed bottom-5 right-5 z-50 rounded-md px-4 py-3 text-sm text-white shadow-lg", msg.ok ? "bg-neutral-900" : "bg-red-700")}>
      {msg.text}
    </div>
  ) : null;
  return [setMsg, node] as const;
}

/** Local copy of a server-ordered list that re-syncs when the server data changes. */
function useSyncedList<T>(list: T[], signature: string) {
  const [prev, setPrev] = useState(signature);
  const [items, setItems] = useState(list);
  if (signature !== prev) {
    setPrev(signature);
    setItems(list);
  }
  return [items, setItems] as const;
}

function useAutoSaveOrder<T extends { id: string }>(items: T[], setItems: (v: T[]) => void, save: (ids: string[]) => Promise<ActionResult>) {
  const [pending, startTransition] = useTransition();
  const [setMsg, toast] = useToast();
  function reorder(next: T[]) {
    const previous = items;
    setItems(next);
    startTransition(async () => {
      try {
        const res = await save(next.map((i) => i.id));
        if (!res.ok) {
          setItems(previous);
          setMsg({ ok: false, text: res.message ?? "Order not saved." });
        } else setMsg({ ok: true, text: "Order saved." });
      } catch {
        setItems(previous);
        setMsg({ ok: false, text: "Network error — order not saved." });
      }
    });
  }
  return { reorder, pending, toast };
}

/* -------------------------------------------------------------------------- */

export function FaqManager({ categories, faqs }: { categories: FaqCategoryRow[]; faqs: FaqRow[] }) {
  const [editing, setEditing] = useState<FaqRow | "new" | null>(null);
  const active = faqs.filter((f) => !f.archived);
  const archived = faqs.filter((f) => f.archived);
  const groups = [
    ...categories.map((c) => ({ id: c.id as string | null, name: c.name, faqs: active.filter((f) => f.categoryId === c.id) })),
    { id: null, name: "Uncategorized", faqs: active.filter((f) => !f.categoryId || !categories.some((c) => c.id === f.categoryId)) },
  ].filter((g) => g.id !== null || g.faqs.length > 0);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-neutral-600">
            {active.length} question{active.length === 1 ? "" : "s"}
            {archived.length ? ` · ${archived.length} archived` : ""}. Drag to reorder within a category.
          </p>
          <button type="button" className={adminButton.primary} onClick={() => setEditing("new")}>
            New question
          </button>
        </div>

        {faqs.length === 0 ? (
          <EmptyState
            title="No FAQs yet"
            description="Answer the questions customers ask most — lead times, wood choices, delivery, care. They appear on the FAQ page and, if you choose, on product pages."
            action={
              <button type="button" className={adminButton.primary} onClick={() => setEditing("new")}>
                Add your first question
              </button>
            }
          />
        ) : (
          groups.map((g) => <FaqGroup key={g.id ?? "none"} name={g.name} faqs={g.faqs} onEdit={setEditing} />)
        )}

        {archived.length ? (
          <section aria-labelledby="faq-archived" className="rounded-md border border-neutral-200 bg-white">
            <h2 id="faq-archived" className="border-b border-neutral-100 px-5 py-3 text-sm font-semibold text-neutral-700">
              Archived ({archived.length}) — hidden from the site
            </h2>
            <ul className="divide-y divide-neutral-100">
              {archived.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1 text-sm text-neutral-600">{f.question}</span>
                  <ActionButton action={() => setFaqArchived(f.id, false)} variant="small" successMessage="Restored.">
                    Restore
                  </ActionButton>
                  <ConfirmAction
                    action={() => deleteFaq(f.id)}
                    label="Delete"
                    variant="small"
                    title="Delete this question permanently?"
                    body={<>“{f.question}” will be deleted. This can&apos;t be undone.</>}
                    confirmLabel="Delete"
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <aside className="min-w-0">
        <CategoryManager categories={categories} />
      </aside>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "New question" : "Edit question"} size="lg">
        {editing !== null ? <FaqForm faq={editing === "new" ? null : editing} categories={categories} onDone={() => setEditing(null)} /> : null}
      </Dialog>
    </div>
  );
}

function FaqGroup({ name, faqs, onEdit }: { name: string; faqs: FaqRow[]; onEdit: (f: FaqRow) => void }) {
  const [items, setItems] = useSyncedList(faqs, JSON.stringify(faqs));
  const { reorder, toast } = useAutoSaveOrder(items, setItems, reorderFaqs);
  return (
    <section aria-label={name} className="rounded-md border border-neutral-200 bg-white">
      <h2 className="border-b border-neutral-100 px-5 py-3 text-sm font-semibold text-neutral-900">
        {name} <span className="font-normal text-neutral-500">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-neutral-500">No questions in this category yet.</p>
      ) : (
        <SortableList
          items={items}
          onReorder={reorder}
          className="divide-y divide-neutral-100"
          renderItem={(f, { handle, moveUp, moveDown }) => (
            <div className="flex flex-wrap items-center gap-2 px-2 py-2.5 sm:flex-nowrap sm:px-3">
              {handle}
              <button type="button" onClick={() => onEdit(f)} className="min-w-0 flex-1 text-left">
                <span className={cn("block text-sm font-medium hover:underline", f.visible ? "text-neutral-900" : "text-neutral-500")}>{f.question}</span>
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {!f.visible ? <Badge tone="amber">Hidden</Badge> : null}
                  {f.showOnProductPages ? <Badge tone="blue">On product pages</Badge> : null}
                </span>
              </button>
              <MoveButtons moveUp={moveUp} moveDown={moveDown} labelUp={`Move “${f.question}” up`} labelDown={`Move “${f.question}” down`} />
              <button type="button" className={adminButton.small} onClick={() => onEdit(f)}>
                Edit
              </button>
              <ActionButton action={() => setFaqArchived(f.id, true)} variant="small" successMessage="Archived.">
                Archive
              </ActionButton>
              <ConfirmAction
                action={() => deleteFaq(f.id)}
                label="Delete"
                variant="small"
                title="Delete this question?"
                body={<>“{f.question}” will be permanently deleted. Archive it instead to hide it but keep the answer.</>}
                confirmLabel="Delete"
              />
            </div>
          )}
        />
      )}
      {toast}
    </section>
  );
}

function FaqForm({ faq, categories, onDone }: { faq: FaqRow | null; categories: FaqCategoryRow[]; onDone: () => void }) {
  return (
    <ActionForm action={(data) => saveFaq(faq?.id ?? null, data)} onSuccess={onDone} className="space-y-4">
      <TextInput name="question" label="Question" required defaultValue={faq?.question ?? ""} maxLength={300} autoFocus />
      <MarkdownEditor name="answer" label="Answer" required defaultValue={faq?.answer ?? ""} rows={8} maxLength={10000} />
      <Select
        name="categoryId"
        label="Category"
        defaultValue={faq?.categoryId ?? ""}
        placeholder="Uncategorized"
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Toggle name="visible" label="Visible on the site" description="Turn off to hide it without archiving." defaultChecked={faq?.visible ?? true} />
        <Toggle name="showOnProductPages" label="Show on product pages" description="Also listed in the FAQ panel of every product page." defaultChecked={faq?.showOnProductPages ?? false} />
      </div>
      <div className="flex justify-end gap-2 border-t border-neutral-100 pt-4">
        <button type="button" className={adminButton.secondary} onClick={onDone}>
          Cancel
        </button>
        <SubmitButton>{faq ? "Save question" : "Add question"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

function CategoryManager({ categories }: { categories: FaqCategoryRow[] }) {
  const [items, setItems] = useSyncedList(categories, JSON.stringify(categories));
  const { reorder, toast } = useAutoSaveOrder(items, setItems, reorderFaqCategories);
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <section aria-labelledby="faq-cats" className="rounded-md border border-neutral-200 bg-white">
      <header className="border-b border-neutral-100 px-5 py-4">
        <h2 id="faq-cats" className="text-base font-semibold text-neutral-900">
          Categories
        </h2>
        <p className="mt-0.5 text-sm text-neutral-500">Group questions on the FAQ page. Drag to reorder.</p>
      </header>
      <div className="p-3">
        {items.length === 0 ? (
          <p className="px-2 py-3 text-sm text-neutral-500">No categories yet — all questions show in one list.</p>
        ) : (
          <SortableList
            items={items}
            onReorder={reorder}
            className="space-y-1"
            renderItem={(c, { handle, moveUp, moveDown }) =>
              renaming === c.id ? (
                <ActionForm action={(data) => renameFaqCategory(c.id, data)} onSuccess={() => setRenaming(null)} successMessage="Renamed." className="rounded border border-neutral-300 p-2">
                  <TextInput name="name" label="Category name" defaultValue={c.name} maxLength={80} autoFocus />
                  <div className="mt-2 flex justify-end gap-2">
                    <button type="button" className={adminButton.small} onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                    <SubmitButton className="h-8 px-3 text-xs">Save</SubmitButton>
                  </div>
                </ActionForm>
              ) : (
                <div className="flex items-center gap-1 rounded px-1 py-1 hover:bg-neutral-50">
                  {handle}
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-900">
                    {c.name} <span className="text-xs text-neutral-500">({c.count})</span>
                  </span>
                  <MoveButtons moveUp={moveUp} moveDown={moveDown} labelUp={`Move ${c.name} up`} labelDown={`Move ${c.name} down`} />
                  <button type="button" className="rounded px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-200" onClick={() => setRenaming(c.id)}>
                    Rename<span className="sr-only"> {c.name}</span>
                  </button>
                  <ConfirmAction
                    action={() => deleteFaqCategory(c.id)}
                    label={
                      <>
                        Delete<span className="sr-only"> {c.name}</span>
                      </>
                    }
                    variant="ghost"
                    className="h-7 px-2 text-xs text-red-700"
                    title={`Delete “${c.name}”?`}
                    body={
                      c.count
                        ? `Its ${c.count} question${c.count === 1 ? "" : "s"} will be kept and moved to Uncategorized.`
                        : "This category has no questions."
                    }
                    confirmLabel="Delete category"
                  />
                </div>
              )
            }
          />
        )}
        <ActionForm action={createFaqCategory} resetOnSuccess className="mt-3 flex items-end gap-2 border-t border-neutral-100 px-2 pt-3">
          <TextInput name="name" label="New category" maxLength={80} placeholder="e.g. Delivery" wrapperClassName="min-w-0 flex-1" />
          <SubmitButton variant="secondary" pendingLabel="Adding…">
            Add
          </SubmitButton>
        </ActionForm>
      </div>
      {toast}
    </section>
  );
}
