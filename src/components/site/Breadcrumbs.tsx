import Link from "next/link";
import { siteUrl } from "@/lib/site-url";
import { cn } from "@/lib/cn";
import { isPathPublic } from "@/lib/cms/pages";
import { JsonLd } from "./JsonLd";

type Crumb = { label: string; href?: string };

/** The trail minus links to Draft/Archived CMS pages (the current page is always kept). */
export async function visibleCrumbs(items: Crumb[]): Promise<Crumb[]> {
  const last = items.length - 1;
  const keep = await Promise.all(items.map(async (c, i) => (i === last || !c.href || c.href.startsWith("http") ? true : isPathPublic(c.href))));
  return items.filter((_, i) => keep[i]);
}

/**
 * Breadcrumb trail (+ BreadcrumbList structured data). Links to CMS pages
 * that are Draft or Archived are left out automatically, so a trail never
 * points visitors (or search engines) at a page they can't open.
 */
export async function Breadcrumbs({ items, className, light }: { items: Crumb[]; className?: string; light?: boolean }) {
  const all = [{ label: "Home", href: "/" }, ...(await visibleCrumbs(items))];
  return (
    <>
      <nav aria-label="Breadcrumb" className={cn("text-[0.72rem] uppercase tracking-[0.14em]", light ? "text-ivory/70" : "text-muted", className)}>
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {all.map((c, i) => (
            <li key={i} className="flex items-center gap-2">
              {c.href && i < all.length - 1 ? (
                <Link href={c.href} className="link-underline inline-block py-1 hover:text-charcoal">
                  {c.label}
                </Link>
              ) : (
                <span aria-current={i === all.length - 1 ? "page" : undefined}>{c.label}</span>
              )}
              {i < all.length - 1 ? <span aria-hidden="true">/</span> : null}
            </li>
          ))}
        </ol>
      </nav>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: all.map((c, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: c.label,
            ...(c.href ? { item: siteUrl(c.href) } : {}),
          })),
        }}
      />
    </>
  );
}
