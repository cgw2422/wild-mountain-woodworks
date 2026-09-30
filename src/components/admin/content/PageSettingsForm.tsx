"use client";

import type { ActionResult } from "@/lib/admin/types";
import { ActionForm, SubmitButton, TextInput } from "@/components/admin/forms";
import { ImageField, type ImageValue } from "@/components/admin/media/ImageField";
import { SeoFields } from "./SeoFields";

/**
 * Page title, menu label, address (pages created in the admin only), SEO
 * fields and social share image. Status is changed with the page's status
 * buttons, not here.
 */
export function PageSettingsForm({
  action,
  title,
  defaultTitle,
  navLabel,
  slug,
  seoTitle,
  seoDescription,
  ogImage,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  title: string;
  defaultTitle: string;
  navLabel: string | null;
  /** Editable address for created pages; null for pages with a fixed route. */
  slug: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImage: ImageValue | null;
}) {
  return (
    <ActionForm action={action} className="space-y-5" redirectTo={slug ? (r) => (r.id ? `/admin/pages/${r.id}` : `/admin/pages/${slug}`) : undefined}>
      <div className="grid gap-4 md:grid-cols-2">
        <TextInput name="title" label="Page title" required defaultValue={title} maxLength={120} help="Used as the page name and the default browser/search title." />
        <TextInput
          name="navLabel"
          label="Navigation label"
          defaultValue={navLabel ?? ""}
          maxLength={40}
          help="Optional shorter name used when this page is added to a menu. Blank = the page title."
        />
        {slug ? (
          <TextInput
            name="slug"
            label="Page address"
            defaultValue={slug}
            maxLength={60}
            className="font-mono"
            help="The page's URL: /your-address. Lowercase letters, numbers and hyphens. Changing it updates menus automatically, but old links to the page stop working."
          />
        ) : null}
      </div>
      <SeoFields title={seoTitle} description={seoDescription} titlePlaceholder={defaultTitle} />
      <ImageField
        name="ogImageId"
        label="Social share image"
        value={ogImage}
        slot="og"
        help="Shown when this page is shared on Facebook, Pinterest, iMessage and similar. Falls back to the default image in Settings."
      />
      <div className="flex justify-end border-t border-neutral-100 pt-4">
        <SubmitButton>Save page settings</SubmitButton>
      </div>
    </ActionForm>
  );
}
