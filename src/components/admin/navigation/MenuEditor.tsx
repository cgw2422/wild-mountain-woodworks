"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/admin/types";
import { MENU_ITEM_TYPES, type MenuItemTypeKey } from "@/lib/navigation/definitions";
import { ActionForm, ConfirmAction, Select, SubmitButton, TextInput, Toggle } from "@/components/admin/forms";
import { Badge, Card, adminButton } from "@/components/admin/ui";
import { SortableList } from "@/components/admin/Sortable";
import { cn } from "@/lib/cn";

export interface EditorItem {
  id: string;
  parentId: string | null;
  type: MenuItemTypeKey;
  label: string;
  displayLabel: string;
  destination: string | null;
  url: string | null;
  pageId: string | null;
  categoryId: string | null;
  productId: string | null;
  enabled: boolean;
  openInNewTab: boolean;
  /** Why visitors don't see it right now, or null when it's live. */
  hidden: string | null;
}

export interface EditorOptions {
  pages: Array<{ id: string; label: string; path: string; status: string }>;
  categories: Array<{ id: string; label: string; hidden: boolean }>;
  products: Array<{ id: string; label: string; live: boolean }>;
}

type Actions = {
  saveTitle: (data: FormData) => Promise<ActionResult>;
  create: (data: FormData) => Promise<ActionResult>;
  update: (id: string, data: FormData) => Promise<ActionResult>;
  remove: (id: string) => Promise<ActionResult>;
  setEnabled: (id: string, enabled: boolean) => Promise<ActionResult>;
  reorder: (parentId: string | null, ids: string[]) => Promise<ActionResult>;
};

const TYPE_LABEL = Object.fromEntries(MENU_ITEM_TYPES.map((t) => [t.type, t.label])) as Record<MenuItemTypeKey, string>;

/**
 * One menu: drag to reorder (top level and within each dropdown), add, edit,
 * show/hide and remove items. All changes go through server actions that
 * validate and re-check permissions; the list refreshes from the server.
 */
export function MenuEditor({
  menuKey,
  name,
  description,
  maxDepth,
  title,
  items,
  options,
  actions,
}: {
  menuKey: string;
  name: string;
  description: string;
  maxDepth: number;
  title: string | null;
  items: EditorItem[];
  options: EditorOptions;
  actions: Actions;
}) {
  const [adding, setAdding] = useState(false);
  const top = items.filter((i) => !i.parentId);
  const childrenOf = (id: string) => items.filter((i) => i.parentId === id);

  return (
    <Card id={`menu-${menuKey}`} title={name} description={description}>
      {menuKey !== "MAIN" ? (
        <ActionForm action={actions.saveTitle} className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end" successMessage="Heading saved.">
          <TextInput name="title" label="Heading shown above the links" defaultValue={title ?? ""} maxLength={60} wrapperClassName="sm:w-80" />
          <SubmitButton variant="secondary">Save heading</SubmitButton>
        </ActionForm>
      ) : null}

      {top.length ? (
        <Level items={top} parentId={null} actions={actions} render={(item) => (
          <>
            <ItemRow item={item} items={items} maxDepth={maxDepth} options={options} actions={actions} />
            {maxDepth > 1 && childrenOf(item.id).length ? (
              <div className="ml-10 mt-1 border-l border-neutral-200 pl-3">
                <Level
                  items={childrenOf(item.id)}
                  parentId={item.id}
                  actions={actions}
                  render={(child) => <ItemRow item={child} items={items} maxDepth={maxDepth} options={options} actions={actions} />}
                />
              </div>
            ) : null}
          </>
        )} />
      ) : (
        <p className="rounded-md border border-dashed border-neutral-300 p-4 text-sm text-neutral-600">No items yet — this menu isn&apos;t shown on the site.</p>
      )}

      <div className="mt-4 border-t border-neutral-100 pt-4">
        {adding ? (
          <ItemForm
            heading="Add item"
            items={items}
            maxDepth={maxDepth}
            options={options}
            action={actions.create}
            onDone={() => setAdding(false)}
          />
        ) : (
          <button type="button" className={adminButton.secondary} onClick={() => setAdding(true)}>
            + Add item
          </button>
        )}
      </div>
    </Card>
  );
}

/** One sortable level. Order is saved to the server as soon as it changes. */
function Level({
  items,
  parentId,
  actions,
  render,
}: {
  items: EditorItem[];
  parentId: string | null;
  actions: Actions;
  render: (item: EditorItem) => React.ReactNode;
}) {
  const router = useRouter();
  const [order, setOrder] = useState(items);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const key = items.map((i) => i.id).join(",");
  // Take fresh server data after a refresh.
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setOrder(items);
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const current = order.map((o) => byId.get(o.id) ?? o);
  return (
    <>
      <SortableList
        items={current}
        className="space-y-1"
        onReorder={(next) => {
          setOrder(next);
          setError(null);
          start(async () => {
            const res = await actions.reorder(parentId, next.map((i) => i.id));
            if (!res.ok) setError(res.message ?? "Couldn't save the order.");
            router.refresh();
          });
        }}
        renderItem={(item, { handle, moveUp, moveDown }) => (
          <div className="flex items-start gap-1">
            {handle}
            <div className="min-w-0 flex-1">{render(item)}</div>
            <span className="flex flex-col sm:flex-row">
              <button type="button" onClick={moveUp} disabled={!moveUp} className="flex h-11 w-11 items-center justify-center text-xs text-neutral-400 hover:text-neutral-800 disabled:opacity-30 sm:h-8 sm:w-8" aria-label="Move up">
                ▲
              </button>
              <button type="button" onClick={moveDown} disabled={!moveDown} className="flex h-11 w-11 items-center justify-center text-xs text-neutral-400 hover:text-neutral-800 disabled:opacity-30 sm:h-8 sm:w-8" aria-label="Move down">
                ▼
              </button>
            </span>
          </div>
        )}
      />
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </>
  );
}

function ItemRow({ item, items, maxDepth, options, actions }: { item: EditorItem; items: EditorItem[]; maxDepth: number; options: EditorOptions; actions: Actions }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const children = items.filter((i) => i.parentId === item.id).length;
  return (
    <div className={cn("rounded-md border border-neutral-200 bg-white", !item.enabled && "bg-neutral-50")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <span className={cn("font-medium", item.enabled ? "text-neutral-900" : "text-neutral-400 line-through")}>{item.displayLabel}</span>
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[0.7rem] text-neutral-600">{TYPE_LABEL[item.type]}</span>
        {item.destination ? <span className="truncate font-mono text-xs text-neutral-500">{item.destination}</span> : null}
        {item.openInNewTab ? <span className="text-xs text-neutral-500">new tab ↗</span> : null}
        {item.hidden ? <Badge tone={item.enabled ? "amber" : "neutral"}>{item.hidden}</Badge> : <Badge tone="green">Live</Badge>}
        <span className="ml-auto flex flex-wrap gap-1.5">
          <button type="button" className={adminButton.small} onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
            {editing ? "Close" : "Edit"}
          </button>
          <button
            type="button"
            className={adminButton.small}
            disabled={pending}
            onClick={() =>
              start(async () => {
                await actions.setEnabled(item.id, !item.enabled);
                router.refresh();
              })
            }
          >
            {item.enabled ? "Disable" : "Enable"}
          </button>
          <ConfirmAction
            action={() => actions.remove(item.id)}
            label="Remove"
            variant="small"
            title={`Remove “${item.displayLabel}”?`}
            body={children ? `Its ${children} sub-item(s) are removed too. The page, category or product itself isn't affected.` : "The page, category or product itself isn't affected."}
            confirmLabel="Remove"
          />
        </span>
      </div>
      {editing ? (
        <div className="border-t border-neutral-100 p-3">
          <ItemForm heading="Edit item" item={item} items={items} maxDepth={maxDepth} options={options} action={actions.update.bind(null, item.id)} onDone={() => setEditing(false)} />
        </div>
      ) : null}
    </div>
  );
}

function ItemForm({
  heading,
  item,
  items,
  maxDepth,
  options,
  action,
  onDone,
}: {
  heading: string;
  item?: EditorItem;
  items: EditorItem[];
  maxDepth: number;
  options: EditorOptions;
  action: (data: FormData) => Promise<ActionResult>;
  onDone: () => void;
}) {
  const [type, setType] = useState<MenuItemTypeKey>(item?.type ?? "INTERNAL_PAGE");
  const [newTab, setNewTab] = useState(item?.openInNewTab ?? false);
  const types = MENU_ITEM_TYPES.filter((t) => maxDepth > 1 || t.type !== "LABEL");
  const help = MENU_ITEM_TYPES.find((t) => t.type === type)?.help;
  const hasChildren = item ? items.some((i) => i.parentId === item.id) : false;
  const parents = items.filter((i) => !i.parentId && i.id !== item?.id);

  return (
    <ActionForm action={action} onSuccess={onDone} className="space-y-4" successMessage={item ? "Saved." : "Added."}>
      <p className="text-sm font-semibold text-neutral-900">{heading}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Select
          name="type"
          label="Links to"
          value={type}
          onChange={(e) => {
            const next = e.target.value as MenuItemTypeKey;
            setType(next);
            // New external links default to opening in a new tab.
            if (!item && next === "EXTERNAL_LINK") setNewTab(true);
          }}
          options={types.map((t) => ({ value: t.type, label: t.label }))}
          help={help}
        />
        <TextInput
          name="label"
          label="Label"
          defaultValue={item?.label ?? ""}
          maxLength={60}
          required={type === "CUSTOM_INTERNAL_LINK" || type === "EXTERNAL_LINK" || type === "LABEL"}
          help={type === "INTERNAL_PAGE" || type === "PRODUCT_CATEGORY" || type === "PRODUCT" ? "Optional. Blank = its own name." : undefined}
        />
        {type === "INTERNAL_PAGE" ? (
          <Select
            name="pageId"
            label="Page"
            defaultValue={item?.pageId ?? ""}
            placeholder="Choose a page…"
            options={options.pages.map((p) => ({ value: p.id, label: `${p.label} — ${p.path}${p.status !== "PUBLISHED" ? ` (${p.status.toLowerCase()}, hidden until published)` : ""}` }))}
          />
        ) : null}
        {type === "PRODUCT_CATEGORY" ? (
          <Select
            name="categoryId"
            label="Category"
            defaultValue={item?.categoryId ?? ""}
            placeholder="Choose a category…"
            options={options.categories.map((c) => ({ value: c.id, label: `${c.label}${c.hidden ? " (hidden)" : ""}` }))}
          />
        ) : null}
        {type === "PRODUCT" ? (
          <Select
            name="productId"
            label="Product"
            defaultValue={item?.productId ?? ""}
            placeholder="Choose a product…"
            options={options.products.map((p) => ({ value: p.id, label: `${p.label}${p.live ? "" : " (not live)"}` }))}
          />
        ) : null}
        {type === "CUSTOM_INTERNAL_LINK" || type === "EXTERNAL_LINK" ? (
          <TextInput
            name="url"
            label={type === "EXTERNAL_LINK" ? "Web address" : "Path on this site"}
            defaultValue={item?.url ?? ""}
            required
            maxLength={500}
            className="font-mono"
            placeholder={type === "EXTERNAL_LINK" ? "https://instagram.com/…" : "/furniture/sale"}
          />
        ) : null}
        {maxDepth > 1 && type !== "LABEL" && !hasChildren ? (
          <Select
            name="parentId"
            label="Show inside"
            defaultValue={item?.parentId ?? ""}
            placeholder="Top level"
            options={parents.map((p) => ({ value: p.id, label: `Dropdown: ${p.displayLabel}` }))}
            help="Put this item in another item's dropdown."
          />
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Toggle label="Enabled" name="enabled" defaultChecked={item?.enabled ?? true} description="Disabled items stay here but aren't shown." />
        {type !== "LABEL" ? (
          <Toggle label="Open in a new tab" name="openInNewTab" checked={newTab} onChange={setNewTab} description="Usually only for external links." />
        ) : null}
      </div>
      <div className="flex gap-2">
        <SubmitButton pendingLabel="Saving…">{item ? "Save item" : "Add item"}</SubmitButton>
        <button type="button" className={adminButton.secondary} onClick={onDone}>
          Cancel
        </button>
      </div>
    </ActionForm>
  );
}
