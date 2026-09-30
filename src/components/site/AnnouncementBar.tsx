"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { DISMISS_COOKIE, isExternalLink, withDismissed } from "@/lib/promotions/announcement";
import type { AnnouncementView } from "@/lib/promotions/queries";

function readCookie(name: string) {
  return document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/**
 * Slim, static promotion bar above the main navigation. No motion. When a
 * visitor closes it, the promotion's key is remembered in a cookie so the
 * server stops rendering it (no flash on later pages); a new promotion has
 * a new key and appears again.
 */
export function AnnouncementBar({ announcement: a, preview = false }: { announcement: AnnouncementView; preview?: boolean }) {
  const [hidden, setHidden] = useState(false);
  if (hidden || (!a.showOnDesktop && !a.showOnMobile)) return null;

  function dismiss() {
    if (!preview) {
      const value = encodeURIComponent(withDismissed(readCookie(DISMISS_COOKIE), a.key));
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${DISMISS_COOKIE}=${value}; Path=/; Max-Age=${60 * 60 * 24 * 180}; SameSite=Lax${secure}`;
    }
    setHidden(true);
  }

  const text = (
    <>
      <span className="font-medium">{a.message}</span>
      {a.secondaryText ? <span className="opacity-85"> · {a.secondaryText}</span> : null}
      {a.endsLabel ? <span className="opacity-85"> · {a.endsLabel}</span> : null}
      {a.linkUrl && a.linkText ? (
        <span className="ml-2 whitespace-nowrap font-semibold underline decoration-bronze-light decoration-1 underline-offset-4 group-hover:decoration-2">
          {a.linkText}
          <span aria-hidden="true"> →</span>
        </span>
      ) : null}
    </>
  );

  return (
    <div
      role="region"
      aria-label="Announcement"
      className={cn(!a.showOnMobile && "hidden md:block", !a.showOnDesktop && "md:hidden")}
      style={{ backgroundColor: a.backgroundColor, color: a.textColor }}
    >
      <div className="relative mx-auto flex min-h-10 max-w-[96rem] items-center justify-center px-12 py-2 text-center text-[0.78rem] leading-snug tracking-[0.02em] sm:text-[0.8rem]">
        <p>
          {a.linkUrl ? (
            isExternalLink(a.linkUrl) ? (
              <a href={a.linkUrl} className="group focus-visible:outline-current" rel="noopener">
                {text}
              </a>
            ) : (
              <Link href={a.linkUrl} className="group focus-visible:outline-current">
                {text}
              </Link>
            )
          ) : (
            text
          )}
        </p>
        {a.dismissible ? (
          <button
            type="button"
            onClick={dismiss}
            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-current sm:right-4"
            aria-label="Close announcement"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}
