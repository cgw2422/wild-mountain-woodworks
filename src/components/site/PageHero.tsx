import { CmsImage } from "@/components/media/CmsImage";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { ButtonLink } from "@/components/ui/Button";
import type { SectionContent } from "@/lib/cms/queries";
import { Breadcrumbs } from "./Breadcrumbs";

/**
 * Interior page header: editorial title block, optional wide image below.
 * Everything comes from the page's "hero" CMS section.
 */
export function PageHero({
  section,
  fallbackTitle,
  breadcrumbs,
  imageSlot = "banner",
  children,
}: {
  section: SectionContent;
  fallbackTitle: string;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  imageSlot?: "banner" | "hero";
  children?: React.ReactNode;
}) {
  return (
    <section aria-labelledby="page-title">
      <Container size="wide" className="pb-12 pt-10 md:pb-16 md:pt-14 lg:pt-16">
        {breadcrumbs ? <Breadcrumbs items={breadcrumbs} className="mb-10 md:mb-14" /> : null}
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            {section.eyebrow ? <Eyebrow className="mb-6">{section.eyebrow}</Eyebrow> : null}
            <h1 id="page-title" className="display-xl animate-reveal">
              {section.heading || fallbackTitle}
            </h1>
          </div>
          {section.body || section.primaryCta ? (
            <div className="lg:col-span-4 lg:pb-3">
              {section.body ? <p className="lede text-muted">{section.body}</p> : null}
              {section.primaryCta ? (
                <ButtonLink href={section.primaryCta.href} className="mt-7" arrow>
                  {section.primaryCta.label}
                </ButtonLink>
              ) : null}
            </div>
          ) : null}
        </div>
        {children}
      </Container>
      {section.image ? (
        <Container size="wide" className="pb-4">
          <CmsImage image={section.image} slot={imageSlot} responsiveRatio priority className="animate-fade" />
        </Container>
      ) : (
        <Container size="wide">
          <div className="h-px bg-stone" />
        </Container>
      )}
    </section>
  );
}
