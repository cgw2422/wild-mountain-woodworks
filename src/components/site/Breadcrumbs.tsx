import Link from "next/link";
import { siteUrl } from "@/lib/site-url";
import { cn } from "@/lib/cn";
import { JsonLd } from "./JsonLd";

export function Breadcrumbs({ items, className, light }: { items: Array<{ label: string; href?: string }>; className?: string; light?: boolean }) {
  const all = [{ label: "Home", href: "/" }, ...items];
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
