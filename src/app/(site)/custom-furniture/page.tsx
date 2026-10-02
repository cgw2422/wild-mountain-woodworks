import type { Metadata } from "next";
import { NOT_FOUND_METADATA, getVisiblePage, requireVisiblePage, withPreviewRobots } from "@/lib/cms/pages";
import { buildMetadata } from "@/lib/seo";
import { getSettings } from "@/lib/settings";
import { getCustomFormSuggestions } from "@/lib/catalog/form-options";
import { CmsImage } from "@/components/media/CmsImage";
import { Container } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Paragraphs, RichText } from "@/components/ui/Markdown";
import { Reveal } from "@/components/ui/Reveal";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { SectionHeading } from "@/components/site/SectionHeading";
import { CustomBuildForm } from "@/components/forms/CustomBuildForm";
import { IfPublic } from "@/components/site/IfPublic";

export async function generateMetadata(): Promise<Metadata> {
  const visible = await getVisiblePage("custom-furniture");
  if (!visible) return NOT_FOUND_METADATA;
  const page = visible.page;
  return withPreviewRobots(visible, buildMetadata({ title: page.seoTitle ?? "Custom Furniture", description: page.seoDescription, path: "/custom-furniture", image: page.ogImage ?? page.section("hero").image }));
}

export default async function CustomFurniturePage() {
  const [page, settings, suggestions] = await Promise.all([requireVisiblePage("custom-furniture").then((v) => v.page), getSettings(), getCustomFormSuggestions()]);
  const hero = page.section("hero");
  const intro = page.section("intro");
  const process = page.section("process");
  const possibilities = page.section("possibilities");
  const gallery = page.section("gallery");
  const form = page.section("form");

  return (
    <>
      {/* Hero */}
      <section aria-labelledby="page-title">
        <Container size="wide" className="pb-12 pt-10 md:pb-16 md:pt-14">
          <Breadcrumbs items={[{ label: "Custom Furniture" }]} className="mb-10 md:mb-14" />
          <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-8">
              {hero.eyebrow ? <Eyebrow className="mb-6">{hero.eyebrow}</Eyebrow> : null}
              <h1 id="page-title" className="display-xl animate-reveal">
                {hero.heading || "Custom Furniture"}
              </h1>
            </div>
            <div className="lg:col-span-4 lg:pb-3">
              <RichText text={hero.body} className="lede text-muted" />
              {hero.primaryCta && settings.customOrdersEnabled ? (
                <ButtonLink href={hero.primaryCta.href} className="mt-7" arrow>
                  {hero.primaryCta.label}
                </ButtonLink>
              ) : null}
            </div>
          </div>
        </Container>
        {hero.image ? (
          <Container size="wide">
            <CmsImage image={hero.image} slot="hero" responsiveRatio priority sizes="100vw" />
          </Container>
        ) : null}
      </section>

      {/* Intro */}
      {intro.visible && intro.heading ? (
        <section className="py-24 md:py-32">
          <Container size="wide">
            <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-20">
              <div className="lg:col-span-5">
                <CmsImage image={intro.image} slot="feature" />
              </div>
              <Reveal className="lg:col-span-6 lg:col-start-7">
                {intro.eyebrow ? <Eyebrow className="mb-6">{intro.eyebrow}</Eyebrow> : null}
                <h2 className="display-lg">{intro.heading}</h2>
                <div className="lede mt-7 space-y-4 text-muted">
                  <Paragraphs text={intro.body} />
                </div>
              </Reveal>
            </div>
          </Container>
        </section>
      ) : null}

      {/* Process */}
      {process.visible && process.items.length ? (
        <section aria-labelledby="process-heading" className="on-dark bg-charcoal py-24 text-ivory md:py-32">
          <Container size="wide">
            <SectionHeading light eyebrow={process.eyebrow} heading={process.heading} subheading={process.subheading} />
            <span id="process-heading" className="sr-only">
              {process.heading || "Process"}
            </span>
            <ol className="mt-16 grid gap-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
              {process.items.map((step, i) => (
                <li key={step.id} className="border-t border-white/20 pt-7">
                  <Reveal delay={i * 90}>
                    <span className="nums font-display text-5xl text-bronze-light" aria-hidden="true">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="mt-5 font-display text-[1.7rem] leading-tight text-ivory">{step.title}</h3>
                    <RichText text={step.body} className="mt-3 leading-relaxed text-ivory/70" />
                  </Reveal>
                </li>
              ))}
            </ol>
          </Container>
        </section>
      ) : null}

      {/* Possibilities */}
      {possibilities.visible && possibilities.items.length ? (
        <section aria-labelledby="possibilities-heading" className="py-24 md:py-32">
          <Container size="wide">
            <div className="grid gap-14 lg:grid-cols-12 lg:gap-20">
              <div className="lg:col-span-5">
                <SectionHeading eyebrow={possibilities.eyebrow} heading={possibilities.heading} subheading={possibilities.subheading} />
                <span id="possibilities-heading" className="sr-only">
                  {possibilities.heading || "Customization"}
                </span>
                {possibilities.image ? <CmsImage image={possibilities.image} slot="landscape" className="mt-12" sizes="(min-width: 1024px) 40vw, 100vw" /> : null}
              </div>
              <dl className="lg:col-span-6 lg:col-start-7">
                {possibilities.items.map((item) => (
                  <div key={item.id} className="grid gap-2 border-t border-stone py-7 sm:grid-cols-[12rem_1fr] sm:gap-8">
                    <dt className="font-display text-2xl leading-tight">{item.title}</dt>
                    <RichText as="dd" text={item.body} className="leading-relaxed text-muted" />
                  </div>
                ))}
              </dl>
            </div>
          </Container>
        </section>
      ) : null}

      {/* Gallery */}
      {gallery.visible && gallery.items.some((i) => i.image) ? (
        <section aria-label={gallery.heading ?? "Details"} className="pb-24 md:pb-32">
          <Container size="wide">
            {gallery.heading ? <h2 className="display-md mb-10">{gallery.heading}</h2> : null}
            <ul className="grid gap-5 sm:grid-cols-3 lg:gap-8">
              {gallery.items
                .filter((i) => i.image)
                .map((item) => (
                  <li key={item.id}>
                    <figure>
                      <CmsImage image={item.image} slot="square" sizes="(min-width: 640px) 33vw, 100vw" />
                      {item.title ? <figcaption className="eyebrow mt-4 text-muted">{item.title}</figcaption> : null}
                    </figure>
                  </li>
                ))}
            </ul>
          </Container>
        </section>
      ) : null}

      {/* Form */}
      <section id="custom-build-form" aria-labelledby="form-heading" className="scroll-mt-[calc(6rem+var(--admin-bar-h))] border-t border-stone bg-paper py-24 md:py-32">
        <Container size="wide">
          <div className="grid gap-14 lg:grid-cols-12 lg:gap-20">
            <div className="lg:col-span-4">
              <div className="lg:sticky lg:top-[calc(8rem+var(--admin-bar-h))]">
                {form.eyebrow ? <Eyebrow className="mb-6">{form.eyebrow}</Eyebrow> : null}
                <h2 id="form-heading" className="display-lg">
                  {form.heading || "Tell us about your piece."}
                </h2>
                <RichText text={form.body} className="lede mt-6 text-muted" />
              </div>
            </div>
            <div className="lg:col-span-7 lg:col-start-6">
              {settings.customOrdersEnabled ? (
                <CustomBuildForm {...suggestions} />
              ) : (
                <div className="border border-stone bg-ivory p-8">
                  <h3 className="display-sm">Custom requests are paused.</h3>
                  <p className="mt-3 text-muted">We&apos;re not taking new custom build requests online right now. Please get in touch and we&apos;ll let you know when we can take on new work.</p>
                  <IfPublic path="/contact">
                    <ButtonLink href="/contact" className="mt-6">
                      Contact Us
                    </ButtonLink>
                  </IfPublic>
                </div>
              )}
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
