import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { Logo } from "@/components/brand/Logo";
import { SiteAdminBar } from "@/components/admin-bar/SiteAdminBar";

// Customer quote / invoice / order pages: always rendered per request from
// live data, never indexed, never cached, no referrer (see next.config.ts).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/** Minimal branded frame for customer documents (prints cleanly). */
export default async function DocumentsLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  return (
    <div className="min-h-dvh bg-ivory print:bg-white">
      <div className="sticky top-0 z-[60] print:hidden">
        <SiteAdminBar />
      </div>
      <header className="border-b border-stone print:border-none">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-5 md:px-8">
          <Link href="/" className="inline-flex min-h-11 items-center" aria-label={`${settings.businessName} — home`}>
            <Logo className="h-7 w-auto max-w-[70vw] text-charcoal sm:h-9 md:h-10" title="" />
          </Link>
          <div className="hidden text-right text-xs leading-relaxed text-muted sm:block print:block">
            <p className="font-semibold text-charcoal">{settings.businessName}</p>
            {settings.email ? <p>{settings.email}</p> : null}
            {settings.phone ? <p>{settings.phone}</p> : null}
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-4xl px-5 py-10 md:px-8 md:py-14 print:py-4">
        {children}
      </main>
      <footer className="border-t border-stone py-8 text-center text-xs text-muted print:py-4">
        <p>
          {settings.businessName}
          {settings.locationText ? ` · ${settings.locationText}` : ""}
        </p>
        <p className="mt-1 print:hidden">This page is private to you. Please don&apos;t share its link.</p>
      </footer>
    </div>
  );
}
