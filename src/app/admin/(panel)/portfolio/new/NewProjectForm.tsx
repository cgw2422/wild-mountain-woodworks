"use client";

import type { ActionResult } from "@/lib/admin/types";
import { ActionForm, SubmitButton, TextInput } from "@/components/admin/forms";

export function NewProjectForm({ action }: { action: (formData: FormData) => Promise<ActionResult> }) {
  return (
    <ActionForm action={action} redirectTo={(res) => `/admin/portfolio/${res.id}`} successMessage={null} className="space-y-4">
      <TextInput name="name" label="Project name" required maxLength={160} placeholder="e.g. Walnut Live-Edge Dining Table" autoFocus />
      <TextInput
        name="slug"
        label="URL slug (optional)"
        maxLength={80}
        placeholder="generated from the name"
        help="The project's address: /our-work/your-slug. Lowercase letters, numbers and hyphens. Leave blank to generate it from the name."
      />
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Creating…">Create draft</SubmitButton>
      </div>
    </ActionForm>
  );
}
