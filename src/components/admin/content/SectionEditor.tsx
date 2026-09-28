"use client";

import { useId, useState } from "react";
import type { ActionResult } from "@/lib/admin/types";
import type { SectionDefinition } from "@/lib/cms/definitions";
import { cn } from "@/lib/cn";
import { ActionForm, SubmitButton, TextArea, TextInput, Toggle } from "@/components/admin/forms";
import { ImageField, type ImageValue } from "@/components/admin/media/ImageField";
import { MoveButtons, SortableList } from "@/components/admin/Sortable";
import { Badge, adminButton, formatDate } from "@/components/admin/ui";
import type { SectionItemValue, SectionValue } from "./types";

/**
 * Generic structured-section editor, driven by a SectionDefinition from
 * src/lib/cms/definitions.ts. Used by the Homepage and Pages editors.
 * One form (and one save) per section.
 */
export function SectionEditor({
  definition: def,
  value,
  action,
  linkSuggestions = [],
  id,
}: {
  definition: SectionDefinition;
  value: SectionValue;
  action: (formData: FormData) => Promise<ActionResult>;
  linkSuggestions?: string[];
  id?: string;
}) {
  const uid = useId();
  const listId = `${uid}-links`;
  const has = (f: SectionDefinition["fields"][number]) => def.fields.includes(f);
  const [visible, setVisible] = useState(value.visible);

  return (
    <section id={id} className="scroll-mt-6 rounded-md border border-neutral-200 bg-white" aria-labelledby={`${uid}-title`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 px-5 py-4">
        <div className="min-w-0">
          <h2 id={`${uid}-title`} className="text-base font-semibold text-neutral-900">
            {def.label}
          </h2>
          {def.help ? <p className="mt-0.5 text-sm text-neutral-500">{def.help}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!value.visible ? <Badge tone="amber">Hidden</Badge> : <Badge tone="green">Visible</Badge>}
          {value.updatedAt ? <span className="text-xs text-neutral-500">Updated {formatDate(value.updatedAt, true)}</span> : null}
        </div>
      </header>
      <ActionForm action={action} successMessage={`${def.label} saved — live on the site now.`} className="space-y-5 p-5">
        {def.hideable ? (
          <Toggle
            name="visible"
            label="Show this section"
            description="Turn off to hide the whole section from the public page without losing its content."
            checked={visible}
            onChange={setVisible}
          />
        ) : null}

        <div className={cn("space-y-5", def.hideable && !visible && "opacity-60")}>
          {has("eyebrow") || has("heading") ? (
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              {has("eyebrow") ? (
                <TextInput name="eyebrow" label="Eyebrow" defaultValue={value.eyebrow ?? ""} maxLength={120} help="Small label above the heading." />
              ) : null}
              {has("heading") ? (
                <TextInput name="heading" label="Heading" defaultValue={value.heading ?? ""} maxLength={200} wrapperClassName={has("eyebrow") ? undefined : "md:col-span-2"} />
              ) : null}
            </div>
          ) : null}
          {has("subheading") ? <TextArea name="subheading" label="Subheading" rows={2} defaultValue={value.subheading ?? ""} maxLength={400} /> : null}
          {has("body") ? (
            <TextArea
              name="body"
              label="Body text"
              rows={5}
              defaultValue={value.body ?? ""}
              maxLength={5000}
              help="Leave a blank line between paragraphs. Markdown such as **bold** and [links](/contact) is supported."
            />
          ) : null}
          {has("image") ? (
            <ImageField
              name="imageId"
              label="Image"
              value={value.image}
              slot={def.imageSlot ?? "landscape"}
              help={def.imageHelp}
            />
          ) : null}
          {has("primaryCta") ? (
            <CtaFields prefix="primaryCta" legend="Primary button" label={value.primaryCtaLabel} href={value.primaryCtaHref} listId={listId} />
          ) : null}
          {has("secondaryCta") ? (
            <CtaFields prefix="secondaryCta" legend="Secondary button" label={value.secondaryCtaLabel} href={value.secondaryCtaHref} listId={listId} />
          ) : null}
          {def.items ? <ItemsEditor def={def} initial={value.items} listId={listId} /> : null}
        </div>

        <datalist id={listId}>
          {linkSuggestions.map((href) => (
            <option key={href} value={href} />
          ))}
        </datalist>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-neutral-100 pt-4">
          <SubmitButton>Save {def.label.toLowerCase()}</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}

function CtaFields({ prefix, legend, label, href, listId }: { prefix: string; legend: string; label: string | null; href: string | null; listId: string }) {
  return (
    <fieldset className="rounded border border-neutral-200 p-4">
      <legend className="px-1 text-sm font-medium text-neutral-800">{legend}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput name={`${prefix}Label`} label="Button label" defaultValue={label ?? ""} maxLength={60} placeholder="e.g. Explore Furniture" />
        <TextInput
          name={`${prefix}Href`}
          label="Destination"
          defaultValue={href ?? ""}
          maxLength={500}
          list={listId}
          placeholder="/furniture"
          help="A page path like /custom-furniture, or a full https:// link. Leave both blank to hide the button."
        />
      </div>
    </fieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* Repeatable items                                                            */
/* -------------------------------------------------------------------------- */

function newItemId() {
  return `new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function ItemsEditor({ def, initial, listId }: { def: SectionDefinition; initial: SectionItemValue[]; listId: string }) {
  const cfg = def.items!;
  // Re-sync from the server after a save (new rows get real ids), but keep
  // unsaved edits when some OTHER section's save refreshes the page.
  const signature = JSON.stringify(initial);
  const [prevSignature, setPrevSignature] = useState(signature);
  const [items, setItems] = useState<SectionItemValue[]>(initial);
  if (signature !== prevSignature) {
    setPrevSignature(signature);
    setItems(initial);
  }
  const has = (f: (typeof cfg.fields)[number]) => cfg.fields.includes(f);
  const atMax = cfg.max != null && items.length >= cfg.max;
  const singular = cfg.label.toLowerCase();

  function update(id: string, patch: Partial<SectionItemValue>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  const payload = items.map((i) => ({
    id: i.id,
    eyebrow: i.eyebrow,
    title: i.title,
    body: i.body,
    imageId: i.image?.id ?? null,
    linkLabel: i.linkLabel,
    linkHref: i.linkHref,
    visible: i.visible,
  }));

  return (
    <fieldset>
      <legend className="mb-2 flex w-full flex-wrap items-baseline justify-between gap-2 text-sm font-medium text-neutral-800">
        <span>
          {cfg.label}s <span className="font-normal text-neutral-500">({items.length}{cfg.max ? ` of ${cfg.max} max` : ""})</span>
        </span>
      </legend>
      <input type="hidden" name="items" value={JSON.stringify(payload)} />
      {items.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">
          No {singular}s yet. Add the first one below.
        </p>
      ) : (
        <SortableList
          items={items}
          onReorder={setItems}
          className="space-y-3"
          renderItem={(item, { handle, index, moveUp, moveDown }) => (
            <div className={cn("rounded border border-neutral-200 bg-neutral-50/60", !item.visible && "border-dashed")}>
              <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-2 py-1.5">
                {handle}
                <span className="text-sm font-medium text-neutral-800">
                  {cfg.label} {index + 1}
                  {item.title ? <span className="font-normal text-neutral-500"> — {item.title}</span> : null}
                </span>
                {!item.visible ? <Badge tone="amber">Hidden</Badge> : null}
                <span className="ml-auto flex items-center gap-1">
                  <MoveButtons moveUp={moveUp} moveDown={moveDown} labelUp={`Move ${singular} ${index + 1} up`} labelDown={`Move ${singular} ${index + 1} down`} />
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-200"
                    onClick={() => update(item.id, { visible: !item.visible })}
                    aria-pressed={!item.visible}
                  >
                    {item.visible ? "Hide" : "Show"}
                  </button>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                    onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                    aria-label={`Remove ${singular} ${index + 1}`}
                  >
                    Remove
                  </button>
                </span>
              </div>
              <div className="grid gap-4 p-4 md:grid-cols-2">
                {has("image") ? (
                  <ImageField
                    name={`item-image-${item.id}`}
                    label="Image"
                    value={item.image}
                    slot={cfg.imageSlot ?? "square"}
                    compact
                    onChange={(img: ImageValue | null) => update(item.id, { image: img })}
                    className="md:col-span-2"
                  />
                ) : null}
                {has("eyebrow") ? (
                  <TextInput name={`item-eyebrow-${item.id}`} label="Eyebrow" value={item.eyebrow ?? ""} maxLength={120} onChange={(e) => update(item.id, { eyebrow: e.target.value })} />
                ) : null}
                {has("title") ? (
                  <TextInput
                    name={`item-title-${item.id}`}
                    label={has("image") && cfg.fields.length <= 2 ? "Caption / title" : "Title"}
                    value={item.title ?? ""}
                    maxLength={200}
                    onChange={(e) => update(item.id, { title: e.target.value })}
                    wrapperClassName={has("eyebrow") ? undefined : "md:col-span-2"}
                  />
                ) : null}
                {has("body") ? (
                  <TextArea
                    name={`item-body-${item.id}`}
                    label="Text"
                    rows={3}
                    value={item.body ?? ""}
                    maxLength={2000}
                    onChange={(e) => update(item.id, { body: e.target.value })}
                    wrapperClassName="md:col-span-2"
                  />
                ) : null}
                {has("link") ? (
                  <>
                    <TextInput name={`item-linkLabel-${item.id}`} label="Link label" value={item.linkLabel ?? ""} maxLength={60} onChange={(e) => update(item.id, { linkLabel: e.target.value })} />
                    <TextInput
                      name={`item-linkHref-${item.id}`}
                      label="Link destination"
                      value={item.linkHref ?? ""}
                      maxLength={500}
                      list={listId}
                      placeholder="/our-work"
                      onChange={(e) => update(item.id, { linkHref: e.target.value })}
                    />
                  </>
                ) : null}
              </div>
            </div>
          )}
        />
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={adminButton.small}
          disabled={atMax}
          onClick={() =>
            setItems((prev) => [
              ...prev,
              { id: newItemId(), eyebrow: null, title: null, body: null, image: null, linkLabel: null, linkHref: null, visible: true },
            ])
          }
        >
          + Add {singular}
        </button>
        {atMax ? <span className="text-xs text-neutral-500">Maximum of {cfg.max} reached.</span> : null}
        <span className="text-xs text-neutral-500">Changes to {singular}s are saved with the section.</span>
      </div>
    </fieldset>
  );
}
