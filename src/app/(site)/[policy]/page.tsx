import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { POLICY_SLUGS, getPageDefinition } from "@/lib/cms/definitions";
import { getPageContent } from "@/lib/cms/queries";
import { buildMetadata, plainText } from "@/lib/seo";
import { Container } from "@/components/ui/Container";
import { Markdown } from "@/components/ui/Markdown";
import { PageHero } from "@/components/site/PageHero";
import { cn } from "@/lib/cn";

/**
 * Customer care & policy pages (/shipping-delivery, /warranty, /privacy …).
 * Only slugs defined as policy pages in src/lib/cms/definitions.ts resolve.
 */
type Props = { params: Promise<{ policy: string }> };

async function load(slug: string) {
  if (!POLICY_SLUGS.includes(slug)) return null;
  const page = await getPageContent(slug);
  if (page.status !== "PUBLISHED") return null;
  return page;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { policy } = await params;
  const page = await load(policy);
  if (!page) return { title: "Not found", robots: { index: false } };
  return buildMetadata({
    title: page.seoTitle || page.title,
    description: page.seoDescription || plainText(page.body),
    path: `/${policy}`,
    image: page.ogImage ?? page.section("hero").image,
  });
}

const CARE_LINKS = POLICY_SLUGS.map((slug) => ({ slug, title: getPageDefinition(slug)!.title }));

export default async function PolicyPage({ params }: Props) {
  const { policy } = await params;
  const page = await load(policy);
  if (!page) notFound();

  return (
    <>
      <PageHero section={page.section("hero")} fallbackTitle={page.title} breadcrumbs={[{ label: page.title }]} />
      <Container size="wide" className="py-16 md:py-24">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-20">
          <article className="lg:col-span-7 lg:col-start-2">
            <Markdown className="text-[1.03rem]">{page.body}</Markdown>
            {page.updatedAt ? (
              <p className="mt-14 border-t border-stone pt-6 text-sm text-muted">
                Last updated{" "}
                {new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(page.updatedAt)}
              </p>
            ) : null}
          </article>
          <aside className="lg:col-span-3 lg:col-start-10" aria-label="Customer care">
            <div className="lg:sticky lg:top-32">
              <p className="eyebrow text-bronze-text">Customer Care</p>
              <ul className="mt-5 space-y-3 border-l border-stone pl-5">
                {CARE_LINKS.map((l) => (
                  <li key={l.slug}>
                    <Link
                      href={`/${l.slug}`}
                      aria-current={l.slug === policy ? "page" : undefined}
                      className={cn("text-[0.93rem] transition-colors", l.slug === policy ? "text-charcoal" : "text-muted hover:text-charcoal")}
                    >
                      {l.title}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link href="/faq" className="text-[0.93rem] text-muted transition-colors hover:text-charcoal">
                    FAQ
                  </Link>
                </li>
              </ul>
            </div>
          </aside>
        </div>
      </Container>
    </>
  );
}
