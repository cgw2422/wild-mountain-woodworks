import type { Metadata } from "next";
import { NOT_FOUND_METADATA, getVisiblePage, requireVisiblePage, withPreviewRobots } from "@/lib/cms/pages";
import { buildMetadata } from "@/lib/seo";
import { CmsImage } from "@/components/media/CmsImage";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Paragraphs, RichText } from "@/components/ui/Markdown";
import { Reveal } from "@/components/ui/Reveal";
import { PageHero } from "@/components/site/PageHero";
import { SectionHeading } from "@/components/site/SectionHeading";
import { CtaBand } from "@/components/site/CtaBand";
import { RidgeLine } from "@/components/brand/Logo";

export async function generateMetadata(): Promise<Metadata> {
  const visible = await getVisiblePage("about");
  if (!visible) return NOT_FOUND_METADATA;
  const page = visible.page;
  return withPreviewRobots(visible, buildMetadata({ title: page.seoTitle ?? "About", description: page.seoDescription, path: "/about", image: page.ogImage ?? page.section("hero").image }));
}

export default async function AboutPage() {
  const { page } = await requireVisiblePage("about");
  const intro = page.section("intro");
  const why = page.section("why");
  const craft = page.section("craftsmanship");
  const workshop = page.section("workshop");
  const maker = page.section("maker");

  return (
    <>
      <PageHero section={page.section("hero")} fallbackTitle="About" breadcrumbs={[{ label: "About" }]} imageSlot="hero" />

      {intro.visible && intro.heading ? (
        <section className="py-24 md:py-32">
          <Container size="wide">
            <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-20">
              <Reveal className="order-2 lg:order-1 lg:col-span-6">
                {intro.eyebrow ? <Eyebrow className="mb-6">{intro.eyebrow}</Eyebrow> : null}
                <h2 className="display-lg">{intro.heading}</h2>
                <div className="lede mt-7 space-y-5 text-muted">
                  <Paragraphs text={intro.body} />
                </div>
              </Reveal>
              <div className="order-1 lg:order-2 lg:col-span-5 lg:col-start-8">
                <CmsImage image={intro.image} slot="feature" />
              </div>
            </div>
          </Container>
        </section>
      ) : null}

      {why.visible && why.heading ? (
        <section className="bg-stone-light py-24 md:py-32">
          <Container size="wide">
            <div className="grid gap-14 lg:grid-cols-12 lg:gap-20">
              <div className="lg:col-span-5">
                {why.eyebrow ? <Eyebrow className="mb-6">{why.eyebrow}</Eyebrow> : null}
                <h2 className="display-lg">{why.heading}</h2>
                <RichText text={why.body} className="lede mt-6 text-muted" />
              </div>
              {why.items.length ? (
                <ul className="grid gap-10 sm:grid-cols-2 lg:col-span-6 lg:col-start-7 lg:grid-cols-1">
                  {why.items.map((item) => (
                    <li key={item.id} className="border-t border-stone-dark/40 pt-6">
                      <h3 className="font-display text-[1.75rem] leading-tight">{item.title}</h3>
                      <RichText text={item.body} className="mt-2 leading-relaxed text-muted" />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Container>
        </section>
      ) : null}

      {craft.visible && craft.heading ? (
        <section className="py-24 md:py-32">
          <Container size="wide">
            {craft.image ? <CmsImage image={craft.image} slot="landscape" className="mb-16 md:mb-20" sizes="(min-width: 1536px) 1500px, 100vw" /> : null}
            <div className="grid gap-8 lg:grid-cols-12">
              <div className="lg:col-span-5">
                {craft.eyebrow ? <Eyebrow className="mb-6">{craft.eyebrow}</Eyebrow> : null}
                <h2 className="display-lg">{craft.heading}</h2>
              </div>
              <div className="lede space-y-5 text-muted lg:col-span-6 lg:col-start-7 lg:pt-12">
                <Paragraphs text={craft.body} />
              </div>
            </div>
          </Container>
        </section>
      ) : null}

      {workshop.visible && workshop.items.some((i) => i.image) ? (
        <section className="border-t border-stone py-24 md:py-32">
          <Container size="wide">
            <SectionHeading eyebrow={workshop.eyebrow} heading={workshop.heading} subheading={workshop.subheading} />
            <ul className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
              {workshop.items
                .filter((i) => i.image)
                .map((item, i) => (
                  <li key={item.id} className={i % 3 === 1 ? "lg:mt-14" : undefined}>
                    <figure>
                      <CmsImage image={item.image} slot="portfolioCard" />
                      {item.title ? <figcaption className="eyebrow mt-4 text-muted">{item.title}</figcaption> : null}
                    </figure>
                  </li>
                ))}
            </ul>
          </Container>
        </section>
      ) : null}

      {maker.visible && maker.heading ? (
        <section className="py-24 md:py-32">
          <Container size="wide">
            <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-20">
              <div className="lg:col-span-5">
                <CmsImage image={maker.image} slot="feature" />
              </div>
              <div className="lg:col-span-6 lg:col-start-7">
                <RidgeLine className="mb-8 h-5 w-24 text-bronze" />
                {maker.eyebrow ? <Eyebrow className="mb-6">{maker.eyebrow}</Eyebrow> : null}
                <h2 className="display-lg">{maker.heading}</h2>
                <div className="lede mt-7 space-y-5 text-muted">
                  <Paragraphs text={maker.body} />
                </div>
              </div>
            </div>
          </Container>
        </section>
      ) : null}

      <CtaBand section={page.section("cta")} />
    </>
  );
}
