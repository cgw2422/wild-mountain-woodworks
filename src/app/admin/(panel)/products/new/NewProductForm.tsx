"use client";

import type { ActionResult } from "@/lib/admin/types";
import { ActionForm, Select, SubmitButton } from "@/components/admin/forms";
import { Card } from "@/components/admin/ui";
import { NameSlugFields } from "@/components/admin/catalog/NameSlugFields";

export function NewProductForm({ action, categories }: { action: (data: FormData) => Promise<ActionResult>; categories: Array<{ id: string; name: string }> }) {
  return (
    <ActionForm action={action} successMessage="Draft created." redirectTo={(r) => `/admin/products/${r.id}`}>
      <Card title="New product" description="Start with the basics. The product is created as a draft — nothing goes live until you publish it.">
        <div className="grid gap-4">
          <NameSlugFields mode="create" nameLabel="Product name" namePlaceholder="e.g. The Ridge Dining Table" />
          <Select
            label="Category"
            name="categoryId"
            placeholder="Choose later"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            help="Required before publishing."
          />
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Creating…">Create draft</SubmitButton>
          </div>
        </div>
      </Card>
    </ActionForm>
  );
}
