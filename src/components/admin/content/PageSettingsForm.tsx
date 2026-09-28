"use client";

import type { ActionResult } from "@/lib/admin/types";
import { ActionForm, Select, SubmitButton, TextInput } from "@/components/admin/forms";
import { ImageField, type ImageValue } from "@/components/admin/media/ImageField";
import { Badge } from "@/components/admin/ui";
import { SeoFields } from "./SeoFields";

/** Page title, status (policy pages only), SEO fields and social share image. */
export function PageSettingsForm({
  action,
  title,
  defaultTitle,
  status,
  canDraft,
  seoTitle,
  seoDescription,
  ogImage,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  title: string;
  defaultTitle: string;
  status: "PUBLISHED" | "DRAFT" | "ARCHIVED";
  canDraft: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImage: ImageValue | null;
}) {
  return (
    <ActionForm action={action} className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <TextInput name="title" label="Page title" required defaultValue={title} maxLength={120} help="Used as the page name and the default browser/search title." />
        {canDraft ? (
          <Select
            name="status"
            label="Status"
            defaultValue={status === "DRAFT" ? "DRAFT" : "PUBLISHED"}
            options={[
              { value: "PUBLISHED", label: "Published — visible to visitors" },
              { value: "DRAFT", label: "Draft — hidden from visitors" },
            ]}
            help="Draft pages are hidden from the public site."
          />
        ) : (
          <div>
            <p className="mb-1.5 text-sm font-medium text-neutral-800">Status</p>
            <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
              <Badge tone="green">Published</Badge> Core site pages are always published.
            </p>
          </div>
        )}
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
