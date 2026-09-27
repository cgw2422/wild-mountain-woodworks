"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, undefined);
  return (
    <form action={action} className="mt-6 space-y-4" noValidate={false}>
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
