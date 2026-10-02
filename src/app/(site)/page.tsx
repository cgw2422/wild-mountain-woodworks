import type { Metadata } from "next";
import Link from "next/link";
import { getPageContent } from "@/lib/cms/queries";
import { buildMetadata } from "@/lib/seo";
import { getSettings } from "@/lib/settings";
import { categoryHref, getFeaturedPortfolio, getHomepageCatalog } from "@/lib/catalog/queries";
import { siteUrl } from "@/lib/site-url";
import { CmsImage } from "@/components/media/CmsImage";
import { ButtonLink, Arrow } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Paragraphs, RichText } from "@/components/ui/Markdown";
import { Reveal } from "@/components/ui/Reveal";
import { SectionHeading } from "@/components/site/SectionHeading";
import { ProductCard } from "@/components/site/ProductCard";
import { PortfolioCard } from "@/components/site/PortfolioCard";
import { CtaBand } from "@/components/site/CtaBand";
import { JsonLd } from "@/components/site/JsonLd";
import { RidgeLine } from "@/components/brand/Logo";
import { IfPublic } from "@/components/site/IfPublic";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPageContent("home");
  const hero = page.section("hero");
  return buildMetadata({
    title: page.seoTitle,
    description: page.seoDescription,
    path: "/",
    image: page.ogImage ?? hero.image,
    absoluteTitle: true,
  });
}

export default async function HomePage() {
  const [page, settings, catalog, projects] = await Promise.all([
    getPageContent("home"),
    getSettings(),
    getHomepageCatalog(),
    getFeaturedPortfolio(3),
  ]);
  const hero = page.section("hero");
  const categoriesSection = page.section("categories");
  const featured = page.section("featured");
  const custom = page.section("custom");
  const craft = page.section("craftsmanship");
  const work = page.section("work");
  const about = page.section("about");
  const finalCta = page.section("final-cta");

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FurnitureStore",
          name: settings.businessName,
          slogan: settings.tagline,
          description: settings.defaultSeoDescription ?? settings.brandStatement ?? undefined,
          url: siteUrl("/"),
          logo: siteUrl("/brand/wild-mountain-sitemark-512.png"),
          image: hero.image ? (hero.image.url.startsWith("http") ? hero.image.url : siteUrl(hero.image.url)) : undefined,
          email: settings.email ?? undefined,
          telephone: settings.phone ?? undefined,
          address: settings.addressRegion
            ? { "@type": "PostalAddress", addressLocality: settings.addressLocality ?? undefined, addressRegion: settings.addressRegion, addressCountry: "US" }
            : undefined,
          sameAs: [settings.instagramUrl, settings.facebookUrl, settings.pinterestUrl, settings.houzzUrl].filter(Boolean),
        }}
      />

      {/* ------------------------------------------------------------ Hero */}
      {hero.visible ? (
        <section aria-labelledby="hero-heading" className="relative isolate">
          {hero.image ? (
            <div className="on-dark relative overflow-hidden bg-charcoal text-ivory">
              <CmsImage
                image={hero.image}
                slot="hero"
                responsiveRatio
                priority
                sizes="100vw"
                className="max-h-[calc(100dvh-4.5rem)] min-h-[34rem] w-full md:min-h-[38rem] lg:max-h-[calc(100dvh-5rem)]"
                imgClassName="animate-fade"
              />
              {/* Scrims keep ivory text legible over any photograph. */}
              <div className="absolute inset-0 bg-gradient-to-t from-charcoal/85 via-charcoal/35 to-charcoal/10" />
              <div className="absolute inset-0 bg-gradient-to-r from-charcoal/55 via-charcoal/15 to-transparent" />
              <div className="absolute inset-x-0 bottom-0">
                <Container size="wide" className="pb-12 md:pb-16 lg:pb-20">
                  <HeroText hero={hero} light />
                </Container>
              </div>
            </div>
          ) : (
            <div className="bg-ivory-deep">
              <Container size="wide" className="py-24 md:py-36">
                <HeroText hero={hero} />
              </Container>
            </div>
          )}
        </section>
      ) : null}

      {/* ------------------------------------------------------ Categories */}
      {categoriesSection.visible && catalog.categories.length ? (
        <section aria-labelledby="categories-heading" className="py-24 md:py-32">
          <Container size="wide">
            <Reveal>
              <SectionHeading
                eyebrow={categoriesSection.eyebrow}
                heading={categoriesSection.heading}
                subheading={categoriesSection.subheading}
                className="[&_h2]:scroll-mt-[calc(6rem+var(--admin-bar-h))]"
                action={
                  <IfPublic path="/furniture">
                    <Link href="/furniture" className="inline-flex min-h-11 items-center gap-3 text-[0.74rem] font-semibold uppercase tracking-[0.16em]">
                      <span className="link-underline">Shop all furniture</span>
                      <Arrow />
                    </Link>
                  </IfPublic>
                }
              />
            </Reveal>
            <h2 id="categories-heading" className="sr-only">
              {categoriesSection.heading || "Categories"}
            </h2>
            <ul className="-mx-5 mt-14 flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 pb-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-6 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-5 lg:gap-5">
              {catalog.categories.map((c, i) => (
                <li key={c.id} className="w-[72%] shrink-0 snap-start sm:w-auto">
                  <Reveal delay={i * 70}>
                    <Link href={categoryHref(c)} className="group block">
                      <div className="zoom-on-hover overflow-hidden">
                        <CmsImage image={c.image} slot="category" alt={c.image?.alt || c.name} />
                      </div>
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <span className="font-display text-[1.55rem] leading-tight">{c.name}</span>
                        <Arrow className="text-muted transition-transform duration-500 group-hover:translate-x-1 group-hover:text-charcoal" />
                      </div>
                    </Link>
                  </Reveal>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      ) : null}

      {/* -------------------------------------------------------- Featured */}
      {featured.visible && catalog.featured.length ? (
        <section aria-labelledby="featured-heading" className="bg-paper py-24 md:py-32">
          <Container size="wide">
            <Reveal>
              <SectionHeading
                eyebrow={featured.eyebrow}
                heading={featured.heading}
                subheading={featured.subheading}
                action={
                  featured.primaryCta ? (
                    <ButtonLink href={featured.primaryCta.href} variant="secondary" arrow>
                      {featured.primaryCta.label}
                    </ButtonLink>
                  ) : null
                }
              />
            </Reveal>
            <span id="featured-heading" className="sr-only">
              {featured.heading || "Featured furniture"}
            </span>
            <div className="mt-14 grid gap-x-8 gap-y-16 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-10">
              {catalog.featured.map((p, i) => (
                <Reveal key={p.id} delay={(i % 3) * 90}>
                  <ProductCard product={p} />
                </Reveal>
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      {/* ---------------------------------------------------------- Custom */}
      {custom.visible && custom.heading ? (
        <section aria-labelledby="custom-heading" className="bg-stone-light">
          <div className="mx-auto grid max-w-[96rem] lg:grid-cols-2">
            <div className="relative">
              <CmsImage image={custom.image} slot="feature" className="h-full" sizes="(min-width: 1024px) 50vw, 100vw" />
            </div>
            <div className="flex items-center px-5 py-20 sm:px-8 md:py-28 lg:px-20 xl:px-28">
              <Reveal className="max-w-lg">
                {custom.eyebrow ? <Eyebrow className="mb-6">{custom.eyebrow}</Eyebrow> : null}
                <h2 id="custom-heading" className="display-lg">
                  {custom.heading}
                </h2>
                <div className="lede mt-7 space-y-4 text-muted">
                  <Paragraphs text={custom.body} />
                </div>
                {custom.primaryCta ? (
                  <ButtonLink href={custom.primaryCta.href} className="mt-10" size="lg" arrow>
                    {custom.primaryCta.label}
                  </ButtonLink>
                ) : null}
              </Reveal>
            </div>
          </div>
        </section>
      ) : null}

      {/* --------------------------------------------------- Craftsmanship */}
      {craft.visible && (craft.heading || craft.items.length) ? (
        <section aria-labelledby="craft-heading" className="py-24 md:py-32">
          <Container size="wide">
            <div className="grid gap-14 lg:grid-cols-12 lg:gap-16">
              <div className="lg:col-span-5">
                <Reveal>
                  {craft.eyebrow ? <Eyebrow className="mb-6">{craft.eyebrow}</Eyebrow> : null}
                  <h2 id="craft-heading" className="display-lg">
                    {craft.heading}
                  </h2>
                  {craft.subheading ? <p className="lede mt-6 text-muted">{craft.subheading}</p> : null}
                </Reveal>
                {craft.image ? (
                  <Reveal className="mt-12 hidden lg:block">
                    <CmsImage image={craft.image} slot="landscape" sizes="40vw" />
                  </Reveal>
                ) : null}
              </div>
              <ol className="grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:col-span-7 lg:self-center">
                {craft.items.map((item, i) => (
                  <li key={item.id} className="border-t border-stone pt-7">
                    <Reveal delay={i * 80}>
                      <span className="font-display text-lg text-bronze-text" aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <h3 className="mt-3 font-display text-[1.8rem] leading-tight">{item.title}</h3>
                      <RichText text={item.body} className="mt-3 leading-relaxed text-muted" />
                    </Reveal>
                  </li>
                ))}
              </ol>
              {craft.image ? (
                <div className="lg:hidden">
                  <CmsImage image={craft.image} slot="landscape" />
                </div>
              ) : null}
            </div>
          </Container>
        </section>
      ) : null}

      {/* -------------------------------------------------------- Our work */}
      {work.visible && projects.length ? (
        <section aria-labelledby="work-heading" className="on-dark bg-charcoal py-24 text-ivory md:py-32">
          <Container size="wide">
            <Reveal>
              <SectionHeading
                light
                eyebrow={work.eyebrow}
                heading={work.heading}
                subheading={work.subheading}
                action={
                  work.primaryCta ? (
                    <ButtonLink href={work.primaryCta.href} variant="outline-light" arrow>
                      {work.primaryCta.label}
                    </ButtonLink>
                  ) : null
                }
              />
            </Reveal>
            <span id="work-heading" className="sr-only">
              {work.heading || "Our work"}
            </span>
            <div className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p, i) => (
                <Reveal key={p.id} delay={i * 90} className={i === 1 ? "lg:mt-16" : undefined}>
                  <PortfolioCard project={p} className="[&_.eyebrow]:text-ivory/60 [&_h3]:text-ivory" />
                </Reveal>
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      {/* ----------------------------------------------------------- About */}
      {about.visible && about.heading ? (
        <section aria-labelledby="about-heading" className="py-24 md:py-32">
          <Container size="wide">
            <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-20">
              <Reveal className="order-2 lg:order-1 lg:col-span-5 lg:col-start-2">
                <RidgeLine className="mb-8 h-5 w-24 text-bronze" />
                {about.eyebrow ? <Eyebrow className="mb-6">{about.eyebrow}</Eyebrow> : null}
                <h2 id="about-heading" className="display-lg">
                  {about.heading}
                </h2>
                <div className="lede mt-7 space-y-4 text-muted">
                  <Paragraphs text={about.body} />
                </div>
                {about.primaryCta ? (
                  <ButtonLink href={about.primaryCta.href} variant="secondary" className="mt-10" arrow>
                    {about.primaryCta.label}
                  </ButtonLink>
                ) : null}
              </Reveal>
              <div className="order-1 lg:order-2 lg:col-span-5 lg:col-start-8">
                <CmsImage image={about.image} slot="feature" />
              </div>
            </div>
          </Container>
        </section>
      ) : null}

      <CtaBand section={finalCta} />
    </>
  );
}

function HeroText({ hero, light }: { hero: ReturnType<Awaited<ReturnType<typeof getPageContent>>["section"]>; light?: boolean }) {
  return (
    <div className="max-w-3xl animate-reveal">
      {hero.eyebrow ? (
        <Eyebrow light={light} className={light ? "mb-6 text-ivory/90 [&>span:first-child]:bg-ivory/70" : "mb-6"}>
          {hero.eyebrow}
        </Eyebrow>
      ) : null}
      <h1 id="hero-heading" className={light ? "display-xl text-ivory" : "display-xl"}>
        {hero.heading || "Wild Mountain Woodworks"}
      </h1>
      <RichText text={hero.body} className={`lede mt-6 max-w-xl ${light ? "text-ivory/85" : "text-muted"}`} />
      {hero.primaryCta || hero.secondaryCta ? (
        <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:gap-4">
          {hero.primaryCta ? (
            <ButtonLink href={hero.primaryCta.href} variant={light ? "light" : "primary"} size="lg">
              {hero.primaryCta.label}
            </ButtonLink>
          ) : null}
          {hero.secondaryCta ? (
            <ButtonLink href={hero.secondaryCta.href} variant={light ? "outline-light" : "secondary"} size="lg">
              {hero.secondaryCta.label}
            </ButtonLink>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
