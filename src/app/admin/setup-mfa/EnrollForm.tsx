"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { authButton, authInput } from "../login/AuthShell";
import { confirmEnrollment, startEnrollment, type EnrollStart } from "./actions";

type Started = Extract<EnrollStart, { ok: true }>;

export function EnrollForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<Started | null>(null);
  const [saved, setSaved] = useState(false);

  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      try {
        await fn();
      } catch {
        setError("We couldn't reach the server. Please try again.");
      }
    });

  if (!setup) {
    return (
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const password = String(new FormData(e.currentTarget).get("password") ?? "");
          setError(null);
          run(async () => {
            const res = await startEnrollment(password);
            if (res.ok) setSetup(res);
            else setError(res.error);
          });
        }}
      >
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
            Confirm your password to begin
          </label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className={authInput} />
        </div>
        {error ? (
          <p role="alert" className="border-l-2 border-error bg-error/5 px-3 py-2 text-sm text-error">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={pending} className={authButton}>
          {pending ? "Starting…" : "Continue"}
        </button>
      </form>
    );
  }

  const codesText = setup.backupCodes.join("\n");
  return (
    <div className="mt-6 space-y-6">
      <section aria-labelledby="scan">
        <h2 id="scan" className="text-sm font-semibold">
          1. Scan this QR code with your authenticator app
        </h2>
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URL generated on the server */}
        <img src={setup.qr} alt="QR code for your authenticator app" width={200} height={200} className="mt-3 border border-stone bg-white p-2" />
        <p className="mt-2 text-xs text-muted">
          Can&apos;t scan it? Enter this key manually: <code className="break-all bg-white px-1 py-0.5 font-mono text-charcoal">{setup.secret}</code>
        </p>
      </section>

      <section aria-labelledby="codes">
        <h2 id="codes" className="text-sm font-semibold">
          2. Save your backup codes
        </h2>
        <p className="mt-1 text-xs text-muted">
          Each code works once if you lose your phone. Store them somewhere safe (a password manager is ideal). <strong>They won&apos;t be shown again.</strong>
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-1 bg-white p-3 font-mono text-sm">
          {setup.backupCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <button type="button" className="border border-stone-dark/60 px-3 py-2 text-xs" onClick={() => void navigator.clipboard?.writeText(codesText)}>
            Copy codes
          </button>
          <a
            className="border border-stone-dark/60 px-3 py-2 text-xs"
            download="wild-mountain-backup-codes.txt"
            href={`data:text/plain;charset=utf-8,${encodeURIComponent(`Wild Mountain Woodworks admin backup codes\n\n${codesText}\n`)}`}
          >
            Download
          </a>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-4 w-4" />
          I&apos;ve saved my backup codes
        </label>
      </section>

      <form
        aria-labelledby="confirm"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const code = String(new FormData(e.currentTarget).get("code") ?? "");
          setError(null);
          run(async () => {
            const res = await confirmEnrollment(code);
            if (res.ok) router.replace("/admin");
            else setError(res.error ?? "That code isn't right.");
          });
        }}
      >
        <h2 id="confirm" className="text-sm font-semibold">
          3. Enter the 6-digit code from the app
        </h2>
        <input name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123 456" aria-label="6-digit code" className={`${authInput} tracking-[0.2em]`} />
        {error ? (
          <p role="alert" className="border-l-2 border-error bg-error/5 px-3 py-2 text-sm text-error">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={pending || !saved} className={authButton}>
          {pending ? "Verifying…" : "Turn on two-factor authentication"}
        </button>
      </form>
    </div>
  );
}
