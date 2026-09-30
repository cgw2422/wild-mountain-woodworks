"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { verifyTwoFactorAction, type VerifyState } from "../actions";
import { authButton, authInput } from "../AuthShell";

export function VerifyForm({ next }: { next?: string }) {
  const [method, setMethod] = useState<"totp" | "backup">("totp");
  const [state, setState] = useState<VerifyState>(undefined);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const res = await verifyTwoFactorAction(undefined, fd);
        if (res?.error) {
          setState(res);
          if (inputRef.current) {
            inputRef.current.value = "";
            inputRef.current.focus();
          }
        }
      } catch (err) {
        if ((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw err;
        setState({ error: "We couldn't reach the server. Please try again." });
      }
    });
  }

  const timedOut = state?.error?.includes("timed out");
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <input type="hidden" name="method" value={method} />
      <div>
        <label htmlFor="code" className="mb-1.5 block text-sm font-medium">
          {method === "totp" ? "Authentication code" : "Backup code"}
        </label>
        <input
          ref={inputRef}
          key={method}
          id="code"
          name="code"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode={method === "totp" ? "numeric" : "text"}
          pattern={method === "totp" ? "[0-9 ]{6,7}" : undefined}
          maxLength={method === "totp" ? 7 : 24}
          placeholder={method === "totp" ? "123 456" : "xxxxx-xxxxx"}
          className={`${authInput} tracking-[0.2em]`}
        />
      </div>
      {state?.error ? (
        <p role="alert" className="border-l-2 border-error bg-error/5 px-3 py-2 text-sm text-error">
          {state.error} {timedOut ? <Link href="/admin/login" className="underline">Sign in again</Link> : null}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={authButton}>
        {pending ? "Verifying…" : "Verify"}
      </button>
      <button
        type="button"
        onClick={() => {
          setMethod((m) => (m === "totp" ? "backup" : "totp"));
          setState(undefined);
        }}
        className="block w-full py-2 text-center text-sm text-muted underline"
      >
        {method === "totp" ? "Lost your phone? Use a backup code" : "Use your authenticator app instead"}
      </button>
    </form>
  );
}
