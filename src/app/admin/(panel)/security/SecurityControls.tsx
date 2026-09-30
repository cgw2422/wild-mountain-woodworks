"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/admin/types";
import { ActionForm, Dialog, SubmitButton, TextInput } from "@/components/admin/forms";
import { adminButton } from "@/components/admin/ui";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-rules";

/** Generate new backup codes (password required). Codes are shown once, here. */
export function BackupCodesButton({ regenerate }: { regenerate: (password: string) => Promise<{ ok: boolean; codes?: string[]; message?: string }> }) {
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const close = () => {
    setOpen(false);
    setCodes(null);
    setError(null);
  };
  return (
    <>
      <button type="button" className={adminButton.secondary} onClick={() => setOpen(true)}>
        Generate new backup codes
      </button>
      <Dialog open={open} onClose={close} title="New backup codes">
        {codes ? (
          <div className="space-y-3">
            <p className="text-sm text-neutral-700">
              Your old backup codes no longer work. Save these somewhere safe — <strong>they won&apos;t be shown again.</strong>
            </p>
            <ul className="grid grid-cols-2 gap-1 rounded bg-neutral-50 p-3 font-mono text-sm">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={adminButton.secondary} onClick={() => void navigator.clipboard?.writeText(codes.join("\n"))}>
                Copy
              </button>
              <button type="button" className={adminButton.primary} onClick={close}>
                I&apos;ve saved them
              </button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const password = String(new FormData(e.currentTarget).get("password") ?? "");
              start(async () => {
                const res = await regenerate(password);
                if (res.ok && res.codes) setCodes(res.codes);
                else setError(res.message ?? "Something went wrong.");
              });
            }}
          >
            <p className="text-sm text-neutral-700">This replaces all of your existing backup codes.</p>
            <TextInput name="password" label="Your password" type="password" autoComplete="current-password" required />
            {error ? (
              <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" className={adminButton.secondary} onClick={close}>
                Cancel
              </button>
              <button type="submit" className={adminButton.primary} disabled={pending}>
                {pending ? "Generating…" : "Generate codes"}
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

/** Password-confirmed dialog around a server action (replace authenticator, reset another admin's password). */
export function PasswordActionButton({
  label,
  title,
  body,
  fieldLabel,
  newPassword,
  confirmLabel,
  action,
  variant = "secondary",
}: {
  label: string;
  title: string;
  body: React.ReactNode;
  fieldLabel: string;
  newPassword?: boolean;
  confirmLabel: string;
  action: (data: FormData) => Promise<ActionResult>;
  variant?: keyof typeof adminButton;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={adminButton[variant]} onClick={() => setOpen(true)}>
        {label}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        {open ? (
          <ActionForm action={action} onSuccess={() => setOpen(false)} className="space-y-4">
            <div className="text-sm text-neutral-700">{body}</div>
            <TextInput
              name="password"
              label={fieldLabel}
              type="password"
              required
              autoComplete={newPassword ? "new-password" : "current-password"}
              help={newPassword ? `At least ${PASSWORD_MIN_LENGTH} characters, with letters and a number or symbol.` : undefined}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className={adminButton.secondary} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <SubmitButton>{confirmLabel}</SubmitButton>
            </div>
          </ActionForm>
        ) : null}
      </Dialog>
    </>
  );
}

/** Change another admin's role, with confirmation. */
export function RoleSelect({ name, role, change }: { name: string; role: "OWNER" | "ADMIN"; change: (role: string) => Promise<ActionResult> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <select
        aria-label={`Role for ${name}`}
        value={role}
        disabled={pending}
        className="h-9 rounded border border-neutral-300 bg-white px-2 text-sm"
        onChange={(e) => {
          const next = e.target.value;
          const text = next === "OWNER" ? `Make ${name} an owner? Owners can manage admin users and security.` : `Change ${name} to admin? They'll lose access to admin users and security.`;
          if (!window.confirm(text)) return;
          setError(null);
          start(async () => {
            const res = await change(next);
            if (!res.ok) setError(res.message ?? "Couldn't change the role.");
            router.refresh();
          });
        }}
      >
        <option value="ADMIN">Admin</option>
        <option value="OWNER">Owner</option>
      </select>
      {error ? (
        <span role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </span>
      ) : null}
    </span>
  );
}
