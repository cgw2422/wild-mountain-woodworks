import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NOT_FOUND_METADATA, getVisiblePage, withPreviewRobots, type VisiblePage } from "@/lib/cms/pages";
import { getMenu } from "@/lib/navigation/menus";
import { buildMetadata, plainText } from "@/lib/seo";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { ButtonLink } from "@/components/ui/Button";
import { Markdown, Paragraphs } from "@/components/ui/Markdown";
import { CmsImage } from "@/components/media/CmsImage";
import { PageHero } from "@/components/site/PageHero";
import { CtaBand } from "@/components/site/CtaBand";
import { cn } from "@/lib/cn";

/**
 * Top-level content pages: customer care & policy pages (/warranty,
 * /privacy …, defined in src/lib/cms/definitions.ts) and pages created in
 * Admin → Pages (/{slug}). Draft and archived pages are 404 for visitors and
 * visible only to signed-in staff in preview (see getVisiblePage).
 */
type Props = { params: Promise<{ slug: string }> };

async function load(slug: string): Promise<VisiblePage | null> {
  const visible = await getVisiblePage(slug);
  return visible && (visible.def.kind === "policy" || visible.def.kind === "custom") ? visible : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const visible = await load(slug);
  if (!visible) return NOT_FOUND_METADATA;
  const { page } = visible;
  return withPreviewRobots(
    visible,
    buildMetadata({
      title: page.seoTitle || page.title,
      description: page.seoDescription || plainText(page.body),
      path: `/${slug}`,
      image: page.ogImage ?? page.section("hero").image,
    }),
  );
}

export default async function ContentPage({ params }: Props) {
  const { slug } = await params;
  const visible = await load(slug);
  if (!visible) notFound();
  return visible.def.kind === "policy" ? <PolicyPage visible={visible} /> : <CustomPage visible={visible} />;
}

function LastUpdated({ at }: { at: Date | null }) {
  if (!at) return null;
  return (
    <p className="mt-14 border-t border-stone pt-6 text-sm text-muted">
      Last updated {new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(at)}
    </p>
  );
}

async function PolicyPage({ visible: { page } }: { visible: VisiblePage }) {
  const care = await getMenu("CUSTOMER_CARE");
  const links = care.items.flatMap((i) => (i.children.length ? i.children : [i])).filter((i) => i.href);
  return (
    <>
      <PageHero section={page.section("hero")} fallbackTitle={page.title} breadcrumbs={[{ label: page.title }]} />
      <Container size="wide" className="py-16 md:py-24">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-20">
          <article className="lg:col-span-7 lg:col-start-2">
            <Markdown className="text-[1.03rem]">{page.body}</Markdown>
            <LastUpdated at={page.updatedAt} />
          </article>
          {links.length ? (
            <aside className="lg:col-span-3 lg:col-start-10" aria-label={care.title || "Customer Care"}>
              <div className="lg:sticky lg:top-[calc(8rem+var(--admin-bar-h))]">
                <p className="eyebrow text-bronze-text">{care.title || "Customer Care"}</p>
                <ul className="mt-5 space-y-3 border-l border-stone pl-5">
                  {links.map((l) => {
                    const current = l.href === `/${page.slug}`;
                    return (
                      <li key={l.id}>
                        <Link
                          href={l.href!}
                          target={l.newTab ? "_blank" : undefined}
                          rel={l.newTab ? "noopener noreferrer" : undefined}
                          aria-current={current ? "page" : undefined}
                          className={cn("text-[0.93rem] transition-colors", current ? "text-charcoal" : "text-muted hover:text-charcoal")}
                        >
                          {l.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </aside>
          ) : null}
        </div>
      </Container>
    </>
  );
}

function CustomPage({ visible: { page } }: { visible: VisiblePage }) {
  const feature = page.section("feature");
  const cta = page.section("cta");
  return (
    <>
      <PageHero section={page.section("hero")} fallbackTitle={page.title} breadcrumbs={[{ label: page.title }]} />
      {page.body?.trim() ? (
        <Container size="wide" className="pb-16 md:pb-24">
          <article className="max-w-3xl lg:ml-[8.333%]">
            <Markdown className="text-[1.03rem]">{page.body}</Markdown>
          </article>
        </Container>
      ) : null}
      {feature.visible && (feature.heading || feature.body) ? (
        <section className="border-t border-stone py-20 md:py-28">
          <Container size="wide">
            <div className={cn("grid items-center gap-14 lg:grid-cols-12 lg:gap-20", !feature.image && "lg:grid-cols-1")}>
              {feature.image ? (
                <div className="lg:col-span-5">
                  <CmsImage image={feature.image} slot="feature" />
                </div>
              ) : null}
              <div className={feature.image ? "lg:col-span-6 lg:col-start-7" : "max-w-3xl"}>
                {feature.eyebrow ? <Eyebrow className="mb-6">{feature.eyebrow}</Eyebrow> : null}
                {feature.heading ? <h2 className="display-lg">{feature.heading}</h2> : null}
                <div className="lede mt-7 space-y-4 text-muted">
                  <Paragraphs text={feature.body} />
                </div>
                {feature.primaryCta ? (
                  <ButtonLink href={feature.primaryCta.href} className="mt-9" arrow>
                    {feature.primaryCta.label}
                  </ButtonLink>
                ) : null}
              </div>
            </div>
          </Container>
        </section>
      ) : null}
      <CtaBand section={cta} />
    </>
  );
}
