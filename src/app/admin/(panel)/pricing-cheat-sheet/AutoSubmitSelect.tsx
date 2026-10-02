"use client";

/** A select that reloads the (GET) form it's in as soon as it changes — no extra tap on a phone. */
export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
