"use client";

import { ActionForm, Select, SubmitButton } from "@/components/admin/forms";
import type { ActionResult } from "@/lib/admin/types";

/**
 * Status select + save. `action` is a server action already bound to the
 * record (see inbox-actions.ts → changeStatusAction). Every change is
 * recorded server-side as a StatusEvent.
 */
export function StatusControl({
  action,
  current,
  options,
  label = "Status",
  help,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  current: string;
  options: Array<{ value: string; label: string }>;
  label?: string;
  help?: string;
}) {
  return (
    // Re-mount when the saved status changes so the select reflects it.
    <ActionForm key={current} action={action} successMessage="Status updated." className="flex flex-col gap-3">
      <Select label={label} name="status" defaultValue={current} options={options} help={help} />
      <div>
        <SubmitButton pendingLabel="Saving…">Update status</SubmitButton>
      </div>
    </ActionForm>
  );
}
