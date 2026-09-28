"use client";

import type { ActionResult } from "@/lib/admin/types";
import { ActionForm, SubmitButton, TextArea, TextInput, Toggle } from "@/components/admin/forms";
import { Card } from "@/components/admin/ui";
import { ImageField, type ImageValue } from "@/components/admin/media/ImageField";
import { CountedInput, CountedTextArea } from "@/components/admin/catalog/CountedField";
import { NameSlugFields } from "@/components/admin/catalog/NameSlugFields";

export type CategoryFormValues = {
  name: string;
  slug: string;
  description: string;
  linkUrl: string;
  seoTitle: string;
  seoDescription: string;
  visible: boolean;
  showOnHomepage: boolean;
  image: ImageValue | null;
  archived: boolean;
};

export function CategoryForm({
  mode,
  values,
  action,
}: {
  mode: "create" | "edit";
  values: CategoryFormValues;
  action: (data: FormData) => Promise<ActionResult>;
}) {
  return (
    <ActionForm
      action={action}
      successMessage={mode === "create" ? "Category created." : "Category saved."}
      redirectTo={mode === "create" ? (r) => `/admin/categories/${r.id}` : undefined}
      className="grid gap-6"
    >
      <Card title="Basic information">
        <div className="grid gap-4">
          <NameSlugFields mode={mode} defaultName={values.name} defaultSlug={values.slug} nameLabel="Category name" namePlaceholder="e.g. Dining Tables" />
          <TextArea
            label="Description"
            name="description"
            defaultValue={values.description}
            rows={4}
            maxLength={2000}
            help="Shown at the top of the category page and on category tiles where space allows."
          />
        </div>
      </Card>

      <Card title="Image" description="Used for the category tile on the homepage and furniture pages.">
        <ImageField name="imageId" label="Category image" slot="category" value={values.image} />
      </Card>

      <Card title="Link" description="Optional destination override.">
        <TextInput
          label="Link URL override"
          name="linkUrl"
          defaultValue={values.linkUrl}
          placeholder="/custom-furniture"
          maxLength={300}
          help="Leave blank to link to this category's product listing. When set (e.g. /custom-furniture), the tile links there instead and the category has no product listing."
        />
      </Card>

      <Card title="Visibility">
        <div className="grid gap-4">
          {values.archived ? (
            <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">This category is archived and hidden from the public site. Restore it to make it visible again.</p>
          ) : null}
          <Toggle
            label="Visible"
            name="visible"
            defaultChecked={values.visible}
            disabled={values.archived}
            description="Hidden categories don't appear anywhere on the public site."
          />
          <Toggle
            label="Show on homepage"
            name="showOnHomepage"
            defaultChecked={values.showOnHomepage}
            disabled={values.archived}
            description="Include this category in the homepage category tiles (in the list order)."
          />
        </div>
      </Card>

      <Card title="SEO" description="Leave blank to use the category name and description.">
        <div className="grid gap-4">
          <CountedInput
            label="SEO title"
            name="seoTitle"
            defaultValue={values.seoTitle}
            recommended={60}
            maxLength={120}
            placeholder={values.name || "Category name"}
            hint="Falls back to the category name."
          />
          <CountedTextArea
            label="SEO description"
            name="seoDescription"
            defaultValue={values.seoDescription}
            recommended={160}
            maxLength={320}
            placeholder={values.description || "Short summary for search results"}
            hint="Falls back to the category description."
          />
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <SubmitButton>{mode === "create" ? "Create category" : "Save category"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
