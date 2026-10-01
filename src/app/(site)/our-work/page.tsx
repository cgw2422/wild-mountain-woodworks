import type { Metadata } from "next";
import { NOT_FOUND_METADATA, getVisiblePage, requireVisiblePage, withPreviewRobots } from "@/lib/cms/pages";
import { buildMetadata } from "@/lib/seo";
import { getPortfolioList } from "@/lib/catalog/queries";
import { Container } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { PageHero } from "@/components/site/PageHero";
import { PortfolioCard } from "@/components/site/PortfolioCard";
import { CtaBand } from "@/components/site/CtaBand";
import { IfPublic } from "@/components/site/IfPublic";

export async function generateMetadata(): Promise<Metadata> {
  const visible = await getVisiblePage("our-work");
  if (!visible) return NOT_FOUND_METADATA;
  const page = visible.page;
  return withPreviewRobots(visible, buildMetadata({ title: page.seoTitle ?? "Our Work", description: page.seoDescription, path: "/our-work", image: page.ogImage ?? page.section("hero").image }));
}

export default async function OurWorkPage() {
  const [page, projects] = await Promise.all([requireVisiblePage("our-work").then((v) => v.page), getPortfolioList()]);
  return (
    <>
      <PageHero section={page.section("hero")} fallbackTitle="Our Work" breadcrumbs={[{ label: "Our Work" }]} />
      <Container size="wide" className="py-16 md:py-24">
        {projects.length ? (
          <ul className="columns-1 gap-8 sm:columns-2 lg:columns-3 lg:gap-10">
            {projects.map((p, i) => (
              <li key={p.id} className="mb-12 break-inside-avoid lg:mb-16">
                <Reveal delay={(i % 3) * 80}>
                  <PortfolioCard project={p} natural sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" />
                  {p.summary ? <p className="mt-2 max-w-md text-[0.93rem] leading-relaxed text-muted">{p.summary}</p> : null}
                </Reveal>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center border border-stone bg-paper px-6 py-20 text-center">
            <h2 className="display-sm">Our portfolio is coming soon.</h2>
            <p className="mt-4 max-w-md text-muted">In the meantime, browse the collection or tell us about a piece you have in mind.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <IfPublic path="/furniture">
                <ButtonLink href="/furniture">Explore Furniture</ButtonLink>
              </IfPublic>
              <IfPublic path="/custom-furniture">
                <ButtonLink href="/custom-furniture" variant="secondary">
                  Start a Custom Build
                </ButtonLink>
              </IfPublic>
            </div>
          </div>
        )}
      </Container>
      <CtaBand section={page.section("cta")} />
    </>
  );
}
