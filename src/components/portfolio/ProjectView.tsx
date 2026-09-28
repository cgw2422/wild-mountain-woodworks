import { getPageContent } from "@/lib/cms/queries";
import type { getPortfolioProject } from "@/lib/catalog/queries";
import { Container } from "@/components/ui/Container";
import { Markdown } from "@/components/ui/Markdown";
import { CmsImage } from "@/components/media/CmsImage";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { CtaBand } from "@/components/site/CtaBand";
import { PortfolioCard } from "@/components/site/PortfolioCard";
import { SectionHeading } from "@/components/site/SectionHeading";
import { Eyebrow } from "@/components/ui/Eyebrow";

type Data = NonNullable<Awaited<ReturnType<typeof getPortfolioProject>>>;

export async function ProjectView({ data }: { data: Data }) {
  const shared = await getPageContent("portfolio-project");
  const { project, images, more } = data;
  const [lead, ...rest] = images;
  const facts = [
    { label: "Furniture", value: project.furnitureType },
    { label: "Wood", value: project.wood },
    { label: "Finish", value: project.finish },
    { label: "Dimensions", value: project.dimensions },
    { label: "Location", value: project.location },
  ].filter((f) => f.value?.trim());

  return (
    <>
      <Container size="wide" className="pt-10 md:pt-14">
        <Breadcrumbs items={[{ label: "Our Work", href: "/our-work" }, { label: project.name }]} className="mb-10 md:mb-14" />
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            {project.furnitureType ? <Eyebrow className="mb-6">{project.furnitureType}</Eyebrow> : null}
            <h1 className="display-xl animate-reveal">{project.name}</h1>
          </div>
          {project.summary ? <p className="lede text-muted lg:col-span-4 lg:pb-3">{project.summary}</p> : null}
        </div>
      </Container>

      {lead ? (
        <Container size="wide" className="mt-12">
          <CmsImage image={lead} slot="hero" responsiveRatio priority sizes="100vw" />
        </Container>
      ) : null}

      <Container size="wide" className="py-16 md:py-24">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-20">
          <div className="lg:col-span-7">
            <Markdown className="text-[1.05rem]">{project.description}</Markdown>
          </div>
          {facts.length ? (
            <aside className="lg:col-span-4 lg:col-start-9" aria-label="Project details">
              <dl className="border-t border-stone">
                {facts.map((f) => (
                  <div key={f.label} className="flex justify-between gap-6 border-b border-stone py-4">
                    <dt className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted">{f.label}</dt>
                    <dd className="text-right text-[0.95rem]">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </aside>
          ) : null}
        </div>

        {rest.length ? (
          <div className="mt-16 grid gap-6 sm:grid-cols-2 md:mt-24 lg:gap-8">
            {rest.map((img, i) => {
              const wide = rest.length % 2 === 1 && i === rest.length - 1;
              return (
                <CmsImage
                  key={`${img.id}-${i}`}
                  image={img}
                  slot={wide ? "landscape" : "feature"}
                  className={wide ? "sm:col-span-2" : undefined}
                  sizes={wide ? "100vw" : "(min-width: 640px) 50vw, 100vw"}
                />
              );
            })}
          </div>
        ) : null}
      </Container>

      <CtaBand section={shared.section("cta")} />

      {more.length ? (
        <section aria-labelledby="more-work" className="py-20 md:py-28">
          <Container size="wide">
            <SectionHeading heading="More from the workshop" size="md" />
            <span id="more-work" className="sr-only">
              More from the workshop
            </span>
            <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
              {more.map((p) => (
                <PortfolioCard key={p.id} project={p} />
              ))}
            </div>
          </Container>
        </section>
      ) : null}
    </>
  );
}
