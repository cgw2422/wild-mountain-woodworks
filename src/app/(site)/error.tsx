"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center px-5 py-28 text-center md:py-40">
      <p className="eyebrow text-bronze-text">Something went wrong</p>
      <h1 className="display-lg mt-4">We hit a snag loading this page.</h1>
      <p className="lede mt-5 max-w-md text-muted">Please try again. If the problem continues, contact us and we&apos;ll help directly.</p>
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-12 items-center justify-center bg-charcoal px-7 text-[0.74rem] font-semibold uppercase tracking-[0.16em] text-ivory hover:bg-walnut"
        >
          Try Again
        </button>
        <Link
          href="/contact"
          className="inline-flex min-h-12 items-center justify-center border border-charcoal px-7 text-[0.74rem] font-semibold uppercase tracking-[0.16em] hover:bg-charcoal hover:text-ivory"
        >
          Contact Us
        </Link>
      </div>
      {error.digest ? <p className="mt-8 text-xs text-muted">Reference: {error.digest}</p> : null}
    </div>
  );
}
