"use client";

import { useEffect } from "react";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="rounded-md border border-red-200 bg-white p-8">
      <h1 className="text-lg font-semibold text-neutral-900">This admin page couldn&apos;t load.</h1>
      <p className="mt-2 text-sm text-neutral-600">A temporary problem occurred. Your data is safe. Try again, and if it keeps happening, check the server logs{error.digest ? ` for reference ${error.digest}` : ""}.</p>
      <button type="button" onClick={reset} className="mt-5 inline-flex h-9 items-center rounded bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700">
        Try again
      </button>
    </div>
  );
}
