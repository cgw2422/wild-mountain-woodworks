import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import type { SiteSettings } from "@/lib/settings";
import { categoryHref } from "@/lib/catalog/queries";

type Cat = { id: string; name: string; slug: string; linkUrl: string | null };

export function SiteFooter({ settings, categories }: { settings: SiteSettings; categories: Cat[] }) {
  const year = new Date().getFullYear();
  const socials = [
    { label: "Instagram", href: settings.instagramUrl },
    { label: "Facebook", href: settings.facebookUrl },
    { label: "Pinterest", href: settings.pinterestUrl },
    { label: "Houzz", href: settings.houzzUrl },
  ].filter((s): s is { label: string; href: string } => Boolean(s.href));

  const productCategories = categories.filter((c) => !c.linkUrl);
  const columns = [
    {
      title: "Furniture",
      links: [{ href: "/furniture", label: "All Furniture" }, ...productCategories.map((c) => ({ href: categoryHref(c), label: c.name }))],
    },
    {
      title: "Company",
      links: [
        { href: "/about", label: "About" },
        { href: "/our-work", label: "Our Work" },
        { href: "/custom-furniture", label: "Custom Furniture" },
        { href: "/contact", label: "Contact" },
      ],
    },
    {
      title: "Customer Care",
      links: [
        { href: "/faq", label: "FAQ" },
        { href: "/furniture-care", label: "Furniture Care" },
        { href: "/wood-characteristics", label: "Wood Characteristics" },
        { href: "/shipping-delivery", label: "Shipping & Delivery" },
        { href: "/returns-cancellations", label: "Returns & Cancellations" },
        { href: "/warranty", label: "Warranty" },
      ],
    },
  ];

  return (
    <footer className="on-dark bg-charcoal text-ivory">
      <div className="mx-auto max-w-[96rem] px-5 pb-10 pt-20 sm:px-8 lg:px-12 lg:pt-24">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-4">
            <Link href="/" aria-label="Wild Mountain Woodworks — home" className="inline-block text-ivory [--logo-accent:var(--color-bronze-light)]">
              <Logo variant="stacked" className="w-56" title="" />
            </Link>
            {settings.brandStatement ? <p className="mt-8 max-w-xs text-[0.95rem] leading-relaxed text-ivory/70">{settings.brandStatement}</p> : null}
            <p className="mt-6 font-display text-xl italic text-ivory/90">{settings.tagline}</p>
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:col-span-8 lg:pl-8">
            {columns.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <h2 className="eyebrow text-bronze-light">{col.title}</h2>
                <ul className="mt-5 space-y-3">
                  {col.links.map((l) => (
                    <li key={l.href + l.label}>
                      <Link href={l.href} className="link-underline text-[0.92rem] text-ivory/80 hover:text-ivory">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        {(settings.email || settings.phone || socials.length) ? (
          <div className="mt-16 flex flex-col gap-6 border-t border-white/10 pt-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-ivory/75">
              {settings.email ? (
                <a href={`mailto:${settings.email}`} className="link-underline">
                  {settings.email}
                </a>
              ) : null}
              {settings.phone ? (
                <a href={`tel:${settings.phone.replace(/[^+\d]/g, "")}`} className="link-underline">
                  {settings.phone}
                </a>
              ) : null}
              {settings.locationText ? <span>{settings.locationText}</span> : null}
            </div>
            {socials.length ? (
              <ul className="flex flex-wrap gap-6 text-sm" aria-label="Social media">
                {socials.map((s) => (
                  <li key={s.label}>
                    <a href={s.href} target="_blank" rel="noopener noreferrer" className="link-underline text-ivory/75 hover:text-ivory">
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="mt-10 flex flex-col gap-4 border-t border-white/10 pt-8 text-xs text-ivory/55 sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} {settings.businessName}</p>
          <ul className="flex gap-6">
            <li>
              <Link href="/privacy" className="link-underline hover:text-ivory">
                Privacy
              </Link>
            </li>
            <li>
              <Link href="/terms" className="link-underline hover:text-ivory">
                Terms
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
