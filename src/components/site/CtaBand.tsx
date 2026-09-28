import { CmsImage } from "@/components/media/CmsImage";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import type { SectionContent } from "@/lib/cms/queries";

/** Dark, premium closing call-to-action with an optional darkened background image. */
export function CtaBand({ section, headingLevel = "h2" }: { section: SectionContent; headingLevel?: "h2" | "h3" }) {
  if (!section.visible || (!section.heading && !section.primaryCta)) return null;
  const H = headingLevel;
  return (
    <section className="on-dark relative isolate overflow-hidden bg-charcoal text-ivory">
      {section.image ? (
        <div className="absolute inset-0 -z-10">
          <CmsImage image={section.image} slot="banner" fill sizes="100vw" alt="" />
          <div className="absolute inset-0 bg-charcoal/72" />
        </div>
      ) : null}
      <Container className="flex flex-col items-center py-24 text-center md:py-32 lg:py-40">
        {section.eyebrow ? <Eyebrow light className="mb-6">{section.eyebrow}</Eyebrow> : null}
        {section.heading ? <H className="display-lg max-w-3xl text-ivory">{section.heading}</H> : null}
        {section.body ? <p className="lede mt-6 max-w-xl text-ivory/80">{section.body}</p> : null}
        {section.primaryCta || section.secondaryCta ? (
          <div className="mt-10 flex flex-col gap-4 sm:flex-row">
            {section.primaryCta ? (
              <ButtonLink href={section.primaryCta.href} variant="light" size="lg">
                {section.primaryCta.label}
              </ButtonLink>
            ) : null}
            {section.secondaryCta ? (
              <ButtonLink href={section.secondaryCta.href} variant="outline-light" size="lg">
                {section.secondaryCta.label}
              </ButtonLink>
            ) : null}
          </div>
        ) : null}
      </Container>
    </section>
  );
}
