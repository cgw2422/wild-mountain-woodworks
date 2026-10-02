import { getSettings, salesFlags } from "@/lib/settings";
import { getMenu } from "@/lib/navigation/menus";
import { unpublishedPagePaths } from "@/lib/cms/pages";
import { getActiveAnnouncement } from "@/lib/promotions/queries";
import { AnnouncementBar } from "./AnnouncementBar";
import { SiteAdminBar } from "@/components/admin-bar/SiteAdminBar";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

/** Header + footer wrapper shared by public pages, 404 and admin previews. */
export async function SiteChrome({ children, banner }: { children: React.ReactNode; banner?: React.ReactNode }) {
  const [settings, announcement, main, footer, company, care, legal] = await Promise.all([
    getSettings(),
    getActiveAnnouncement().catch(() => null),
    getMenu("MAIN"),
    getMenu("FOOTER"),
    getMenu("COMPANY"),
    getMenu("CUSTOMER_CARE"),
    getMenu("LEGAL"),
  ]);
  const flags = salesFlags(settings);
  // The header button only points at a page visitors can open.
  const hidden = await unpublishedPagePaths();
  const cta =
    flags.quotes && !hidden.has("/request-quote")
      ? { label: "Request a Quote", href: "/request-quote" }
      : !hidden.has("/contact")
        ? { label: "Contact Us", href: "/contact" }
        : null;
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-[calc(1rem+var(--admin-bar-h))] focus:z-[70] focus:bg-charcoal focus:px-4 focus:py-3 focus:text-sm focus:text-ivory"
      >
        Skip to content
      </a>
      <SiteAdminBar />
      {banner}
      {announcement ? <AnnouncementBar announcement={announcement} /> : null}
      <SiteHeader items={main.items} cta={cta} contact={{ email: settings.email, phone: settings.phone }} />
      <main id="main" className="min-h-[60vh]">
        {children}
      </main>
      <SiteFooter settings={settings} columns={[footer, company, care]} legal={legal} />
    </>
  );
}
