import { getSettings, commerceState } from "@/lib/settings";
import { getNavCategories } from "@/lib/catalog/queries";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

/** Header + footer wrapper shared by public pages, 404 and admin previews. */
export async function SiteChrome({ children, banner }: { children: React.ReactNode; banner?: React.ReactNode }) {
  const [settings, categories] = await Promise.all([getSettings(), getNavCategories()]);
  const flags = commerceState(settings);
  const cta = flags.quotes ? { label: "Request a Quote", href: "/request-quote" } : { label: "Contact Us", href: "/contact" };
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-charcoal focus:px-4 focus:py-3 focus:text-sm focus:text-ivory"
      >
        Skip to content
      </a>
      {banner}
      <SiteHeader cta={cta} contact={{ email: settings.email, phone: settings.phone }} />
      <main id="main" className="min-h-[60vh]">
        {children}
      </main>
      <SiteFooter settings={settings} categories={categories} />
    </>
  );
}
