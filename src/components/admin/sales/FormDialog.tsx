"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/admin/types";
import { ActionForm, Dialog, SubmitButton } from "@/components/admin/forms";
import { adminButton } from "@/components/admin/ui";
import { cn } from "@/lib/cn";

/** A button that opens a dialog containing a small admin form. */
export function FormDialog({
  label,
  title,
  description,
  action,
  children,
  submitLabel = "Save",
  variant = "secondary",
  submitVariant = "primary",
  className,
  redirectToId,
}: {
  label: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action: (fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submitLabel?: string;
  variant?: keyof typeof adminButton;
  submitVariant?: keyof typeof adminButton;
  className?: string;
  /** Navigate to `${redirectToId}${result.id}` on success. */
  redirectToId?: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button type="button" className={cn(adminButton[variant], className)} onClick={() => setOpen(true)}>
        {label}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} size="md">
        {description ? <div className="mb-4 text-sm text-neutral-600">{description}</div> : null}
        <ActionForm
          action={action}
          className="space-y-4"
          successMessage={null}
          onSuccess={(r) => {
            setOpen(false);
            if (redirectToId && r.id) router.push(`${redirectToId}${r.id}`);
          }}
        >
          {children}
          <div className="flex justify-end gap-2 border-t border-neutral-100 pt-4">
            <button type="button" className={adminButton.secondary} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <SubmitButton variant={submitVariant}>{submitLabel}</SubmitButton>
          </div>
        </ActionForm>
      </Dialog>
    </>
  );
}
