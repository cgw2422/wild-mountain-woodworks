import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import type { SiteSettings } from "@/lib/settings";
import type { NavLink, ResolvedMenu } from "@/lib/navigation/menus";

/**
 * Footer. The link columns (Footer, Company, Customer Care menus) and the
 * legal links come from Admin → Navigation; empty menus are simply omitted.
 */
export function SiteFooter({ settings, columns, legal }: { settings: SiteSettings; columns: ResolvedMenu[]; legal: ResolvedMenu }) {
  const year = new Date().getFullYear();
  const socials = [
    { label: "Instagram", href: settings.instagramUrl },
    { label: "Facebook", href: settings.facebookUrl },
    { label: "Pinterest", href: settings.pinterestUrl },
    { label: "Houzz", href: settings.houzzUrl },
  ].filter((s): s is { label: string; href: string } => Boolean(s.href));

  const flat = (m: ResolvedMenu) => m.items.flatMap((i) => [...(i.href ? [i] : []), ...i.children]);
  const cols = columns.map((m) => ({ key: m.key, title: m.title, links: flat(m) })).filter((c) => c.links.length);
  const legalLinks = flat(legal);

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
            {cols.map((col) => (
              <nav key={col.key} aria-label={col.title || "Footer"}>
                {col.title ? <h2 className="eyebrow text-bronze-light">{col.title}</h2> : null}
                <ul className={col.title ? "mt-5 space-y-3" : "space-y-3"}>
                  {col.links.map((l) => (
                    <li key={l.id}>
                      <FooterLink item={l} className="link-underline text-[0.92rem] text-ivory/80 hover:text-ivory" />
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
          {legalLinks.length ? (
            <ul className="flex flex-wrap gap-6" aria-label="Legal">
              {legalLinks.map((l) => (
                <li key={l.id}>
                  <FooterLink item={l} className="link-underline hover:text-ivory" />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ item, className }: { item: NavLink; className?: string }) {
  const newTab = item.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {};
  return item.external ? (
    <a href={item.href!} className={className} {...newTab}>
      {item.label}
    </a>
  ) : (
    <Link href={item.href!} className={className} {...newTab}>
      {item.label}
    </Link>
  );
}
