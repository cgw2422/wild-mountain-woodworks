import type { Metadata } from "next";
import { getPageContent } from "@/lib/cms/queries";
import { buildMetadata, plainText } from "@/lib/seo";
import { getFaqGroups } from "@/lib/catalog/queries";
import { Container } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { Markdown } from "@/components/ui/Markdown";
import { PageHero } from "@/components/site/PageHero";
import { Accordion } from "@/components/site/Accordion";
import { JsonLd } from "@/components/site/JsonLd";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPageContent("faq");
  return buildMetadata({ title: page.seoTitle ?? "FAQ", description: page.seoDescription, path: "/faq", image: page.ogImage });
}

export default async function FaqPage() {
  const [page, groups] = await Promise.all([getPageContent("faq"), getFaqGroups()]);
  const cta = page.section("cta");
  const all = groups.flatMap((g) => g.faqs);

  return (
    <>
      {all.length ? (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: all.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: plainText(f.answer, 2000) } })),
          }}
        />
      ) : null}
      <PageHero section={page.section("hero")} fallbackTitle="Frequently asked questions" breadcrumbs={[{ label: "FAQ" }]} />
      <Container size="wide" className="py-16 md:py-24">
        {groups.length ? (
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-20">
            {groups.length > 1 ? (
              <nav aria-label="FAQ topics" className="min-w-0 lg:col-span-3">
                <ul className="flex gap-x-6 gap-y-2 overflow-x-auto pb-2 lg:sticky lg:top-32 lg:flex-col lg:overflow-visible">
                  {groups.map((g) => (
                    <li key={g.id} className="shrink-0">
                      <a href={`#faq-${g.slug}`} className="link-underline inline-block py-1.5 text-[0.8rem] font-medium uppercase tracking-[0.12em] text-muted hover:text-charcoal">
                        {g.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
            <div className={groups.length > 1 ? "space-y-16 lg:col-span-8 lg:col-start-5" : "lg:col-span-8 lg:col-start-3"}>
              {groups.map((g) => (
                <section key={g.id} id={`faq-${g.slug}`} aria-labelledby={`faq-h-${g.slug}`} className="scroll-mt-28">
                  <h2 id={`faq-h-${g.slug}`} className="display-sm mb-6">
                    {g.name}
                  </h2>
                  <Accordion items={g.faqs.map((f) => ({ id: f.id, title: f.question, content: <Markdown className="text-[0.97rem]">{f.answer}</Markdown> }))} />
                </section>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-muted">Questions and answers are being written. In the meantime, please contact us with any questions.</p>
        )}
      </Container>
      {cta.visible && cta.heading ? (
        <section className="border-t border-stone bg-stone-light">
          <Container size="wide" className="flex flex-col gap-8 py-16 md:flex-row md:items-center md:justify-between md:py-20">
            <div>
              <h2 className="display-md">{cta.heading}</h2>
              {cta.body ? <p className="lede mt-3 text-muted">{cta.body}</p> : null}
            </div>
            {cta.primaryCta ? (
              <ButtonLink href={cta.primaryCta.href} size="lg" arrow>
                {cta.primaryCta.label}
              </ButtonLink>
            ) : null}
          </Container>
        </section>
      ) : null}
    </>
  );
}
