"use client";

import { useState } from "react";
import { isValidSlug, slugify } from "@/lib/slug";
import { adminButton } from "../ui";
import { TextInput } from "../forms";

/**
 * Name + slug inputs for records published under /furniture/[slug].
 *
 * - mode "create": the slug is a read-only preview derived from the name
 *   (the server makes it unique by appending -2, -3…).
 * - mode "edit": the slug is NEVER changed automatically when the name
 *   changes. It can be edited manually (validated here and on the server)
 *   or reset from the current name with an explicit button.
 */
export function NameSlugFields({
  mode,
  defaultName = "",
  defaultSlug = "",
  nameLabel = "Name",
  pathPrefix = "/furniture/",
  namePlaceholder,
  slugHelp,
}: {
  mode: "create" | "edit";
  defaultName?: string;
  defaultSlug?: string;
  nameLabel?: string;
  pathPrefix?: string;
  namePlaceholder?: string;
  slugHelp?: string;
}) {
  const [name, setName] = useState(defaultName);
  const [slug, setSlug] = useState(defaultSlug);
  const preview = mode === "create" ? slugify(name) : slug;
  const invalid = mode === "edit" && slug !== "" && !isValidSlug(slug);
  const changed = mode === "edit" && slug !== defaultSlug;

  return (
    <div className="grid gap-4">
      <TextInput label={nameLabel} name="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder={namePlaceholder} maxLength={160} />
      {mode === "create" ? (
        <div>
          <p className="mb-1 text-sm font-medium text-neutral-800">URL</p>
          <p className="rounded border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-700 [overflow-wrap:anywhere]">
            {pathPrefix}
            {preview || <span className="text-neutral-400">your-slug</span>}
          </p>
          <p className="mt-1 text-xs text-neutral-500">Generated from the name. If it&apos;s already in use a number is added. You can change it later.</p>
        </div>
      ) : (
        <div>
          <div className="flex items-end gap-2">
            <TextInput
              label="Slug"
              name="slug"
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              wrapperClassName="flex-1"
              className="font-mono"
              maxLength={80}
              aria-invalid={invalid || undefined}
            />
            <button
              type="button"
              className={`${adminButton.small} mb-1`}
              onClick={() => setSlug(slugify(name))}
              disabled={!slugify(name) || slugify(name) === slug}
              title="Replace the slug with one generated from the current name"
            >
              Generate from name
            </button>
          </div>
          <p className="mt-1 text-xs text-neutral-500 [overflow-wrap:anywhere]">
            {pathPrefix}
            {slug || "…"} · {slugHelp ?? "Lowercase letters, numbers and hyphens. Shared with category and product URLs."}
          </p>
          {invalid ? <p className="mt-1 text-xs font-medium text-red-600">Use only lowercase letters, numbers and single hyphens.</p> : null}
          {changed && !invalid ? (
            <p className="mt-1 text-xs text-amber-700">Changing the slug changes the public URL. Existing links to the old URL will stop working.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
