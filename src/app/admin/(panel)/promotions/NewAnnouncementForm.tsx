"use client";

import { ActionForm, SubmitButton, TextInput } from "@/components/admin/forms";
import { createAnnouncement } from "./actions";

export function NewAnnouncementForm() {
  return (
    <ActionForm action={createAnnouncement} redirectTo={(r) => `/admin/promotions/${r.id}`} successMessage={null} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <TextInput name="name" label="Internal name" placeholder="e.g. Fall Sale 2026" required maxLength={80} wrapperClassName="sm:w-80" />
      <SubmitButton pendingLabel="Creating…">Create</SubmitButton>
    </ActionForm>
  );
}
