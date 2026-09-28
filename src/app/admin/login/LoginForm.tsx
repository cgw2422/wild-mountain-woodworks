"use client";

import { useRef, useState, useTransition } from "react";
import { loginAction, type LoginState } from "./actions";

/**
 * Submits via a transition instead of `<form action>` so a failed attempt
 * doesn't reset the form (React resets forms after actions), keeping the
 * email filled in. Successful sign-in redirects from the server action.
 */
export function LoginForm({ next }: { next?: string }) {
  const [state, setState] = useState<LoginState>(undefined);
  const [pending, startTransition] = useTransition();
  const passwordRef = useRef<HTMLInputElement>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const res = await loginAction(undefined, fd);
        if (res?.error) {
          setState(res);
          if (passwordRef.current) {
            passwordRef.current.value = "";
            passwordRef.current.focus();
          }
        }
      } catch (err) {
        // redirect() after a successful sign-in is surfaced as a thrown
        // navigation signal that Next.js handles; anything else is a failure.
        if ((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw err;
        setState({ error: "We couldn't reach the server. Please try again." });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="h-11 w-full border border-stone-dark/60 bg-white px-3 text-base outline-none focus:border-charcoal"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
          Password
        </label>
        <input
          ref={passwordRef}
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11 w-full border border-stone-dark/60 bg-white px-3 text-base outline-none focus:border-charcoal"
        />
      </div>
      {state?.error ? (
        <p role="alert" className="border-l-2 border-error bg-error/5 px-3 py-2 text-sm text-error">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full bg-charcoal text-xs font-semibold uppercase tracking-[0.16em] text-ivory transition hover:bg-walnut disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
