import Link from "next/link";
import { RichText } from "@/components/ui/Markdown";
import { cn } from "@/lib/cn";
import type { ProductCardData } from "@/lib/catalog/queries";
import { Container } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import type { SectionContent } from "@/lib/cms/queries";
import { ProductCard } from "./ProductCard";
import { IfPublic } from "@/components/site/IfPublic";

/** Category filter + editorial product grid shared by /furniture and /furniture/[category]. */
export function CatalogView({
  categories,
  activeSlug,
  products,
  customCta,
  saleCount = 0,
  empty,
}: {
  categories: Array<{
    id: string;
    name: string;
    slug: string;
    linkUrl: string | null;
  }>;
  /** A category slug, or "sale" for /furniture/sale. */
  activeSlug?: string;
  products: ProductCardData[];
  customCta: SectionContent;
  /** Pieces on sale right now; a "Sale" filter appears only when there are any. */
  saleCount?: number;
  /** Custom empty state (the sale page's CMS section). */
  empty?: SectionContent;
}) {
  const filters = categories.filter((c) => !c.linkUrl);
  return (
    <>
      <Container size="wide">
        <nav aria-label="Filter by category" className="border-b border-stone">
          <ul className="-mb-px flex gap-8 overflow-x-auto pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <li className="shrink-0">
              <FilterLink href="/furniture" active={!activeSlug}>
                All
              </FilterLink>
            </li>
            {filters.map((c) => (
              <li key={c.id} className="shrink-0">
                <FilterLink
                  href={`/furniture/${c.slug}`}
                  active={activeSlug === c.slug}
                >
                  {c.name}
                </FilterLink>
              </li>
            ))}
            {saleCount > 0 || activeSlug === "sale" ? (
              <li className="shrink-0">
                <FilterLink
                  href="/furniture/sale"
                  active={activeSlug === "sale"}
                  accent
                >
                  Sale
                </FilterLink>
              </li>
            ) : null}
          </ul>
        </nav>
        <p className="mt-6 text-sm text-muted" aria-live="polite">
          {products.length} {products.length === 1 ? "piece" : "pieces"}
        </p>
      </Container>

      <Container size="wide" className="pb-24 pt-10 md:pb-32">
        {products.length ? (
          <div className="grid gap-x-8 gap-y-16 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-10 lg:gap-y-20">
            {products.map((p, i) => (
              <Reveal key={p.id} delay={(i % 3) * 80}>
                <ProductCard product={p} priority={i < 3} />
              </Reveal>
            ))}
          </div>
        ) : empty ? (
          <div className="flex flex-col items-center border border-stone bg-paper px-6 py-20 text-center">
            <h2 className="display-sm">
              {empty.heading || "Nothing is on sale right now."}
            </h2>
            <RichText text={empty.body} className="mt-4 max-w-md text-muted" />
            <ButtonLink
              href={empty.primaryCta?.href || "/furniture"}
              className="mt-8"
              arrow
            >
              {empty.primaryCta?.label || "View the Collection"}
            </ButtonLink>
          </div>
        ) : (
          <div className="flex flex-col items-center border border-stone bg-paper px-6 py-20 text-center">
            <h2 className="display-sm">New pieces are on the way.</h2>
            <p className="mt-4 max-w-md text-muted">
              There&apos;s nothing listed here right now — but we build to
              order, so tell us what you&apos;re looking for.
            </p>
            <IfPublic path="/custom-furniture">
              <ButtonLink href="/custom-furniture" className="mt-8" arrow>
                Start a Custom Build
              </ButtonLink>
            </IfPublic>
          </div>
        )}
      </Container>

      {customCta.visible && customCta.heading ? (
        <section className="border-t border-stone bg-stone-light">
          <Container
            size="wide"
            className="flex flex-col gap-8 py-16 md:flex-row md:items-center md:justify-between md:py-20"
          >
            <div className="max-w-2xl">
              <h2 className="display-md">{customCta.heading}</h2>
              <RichText
                text={customCta.body}
                className="lede mt-4 text-muted"
              />
            </div>
            {customCta.primaryCta ? (
              <ButtonLink
                href={customCta.primaryCta.href}
                size="lg"
                arrow
                className="shrink-0"
              >
                {customCta.primaryCta.label}
              </ButtonLink>
            ) : null}
          </Container>
        </section>
      ) : null}
    </>
  );
}

function FilterLink({
  href,
  active,
  accent,
  children,
}: {
  href: string;
  active: boolean;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-12 min-w-6 items-center justify-center border-b py-3 text-[0.8rem] font-medium tracking-[0.04em] transition-colors",
        active
          ? "border-charcoal text-charcoal"
          : "border-transparent text-muted hover:text-charcoal",
        accent && !active && "text-bronze-text",
      )}
    >
      {children}
    </Link>
  );
}
