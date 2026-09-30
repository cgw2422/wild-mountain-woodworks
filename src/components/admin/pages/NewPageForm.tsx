"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, TextInput } from "@/components/admin/forms";
import { slugify } from "@/lib/slug";
import { createPage } from "@/app/admin/(panel)/pages/actions";

export function NewPageForm() {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const shown = slugTouched ? slug : slugify(title).slice(0, 60);
  return (
    <ActionForm action={createPage} redirectTo={(r) => `/admin/pages/${r.id}`} successMessage={null} className="max-w-2xl space-y-5">
      <TextInput name="title" label="Page title" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Financing" />
      <TextInput
        name="slug"
        label="Page address"
        maxLength={60}
        className="font-mono"
        value={shown}
        onChange={(e) => {
          setSlugTouched(true);
          setSlug(e.target.value.toLowerCase());
        }}
        help={`The page will live at /${shown || "your-address"}. Lowercase letters, numbers and hyphens.`}
      />
      <TextInput name="navLabel" label="Navigation label" maxLength={40} help="Optional shorter name for menus. Blank = the page title." />
      <SubmitButton pendingLabel="Creating…">Create draft page</SubmitButton>
    </ActionForm>
  );
}
