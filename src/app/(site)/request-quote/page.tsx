import type { Metadata } from "next";
import { RichText } from "@/components/ui/Markdown";
import { NOT_FOUND_METADATA, getVisiblePage, requireVisiblePage, withPreviewRobots } from "@/lib/cms/pages";
import { buildMetadata } from "@/lib/seo";
import { getSettings } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { publicProductWhere } from "@/lib/catalog/queries";
import { CmsImage } from "@/components/media/CmsImage";
import { Container } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { QuoteRequestForm } from "@/components/forms/QuoteRequestForm";
import { IfPublic } from "@/components/site/IfPublic";

export async function generateMetadata(): Promise<Metadata> {
  const visible = await getVisiblePage("request-quote");
  if (!visible) return NOT_FOUND_METADATA;
  const page = visible.page;
  return withPreviewRobots(visible, buildMetadata({ title: page.seoTitle ?? "Request a Quote", description: page.seoDescription, path: "/request-quote", image: page.ogImage }));
}

export default async function RequestQuotePage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const [page, settings, sp, products] = await Promise.all([
    requireVisiblePage("request-quote").then((v) => v.page),
    getSettings(),
    searchParams,
    prisma.product.findMany({ where: publicProductWhere, orderBy: { displayOrder: "asc" }, select: { name: true, slug: true } }),
  ]);
  const hero = page.section("hero");
  const confirmation = page.section("confirmation");
  const preset = sp.product ? products.find((p) => p.slug === sp.product)?.name : undefined;

  return (
    <Container size="wide" className="pb-24 pt-10 md:pb-32 md:pt-14">
      <Breadcrumbs items={[{ label: "Request a Quote" }]} className="mb-10 md:mb-14" />
      <div className="grid gap-16 lg:grid-cols-12 lg:gap-20">
        <div className="lg:col-span-5">
          {hero.eyebrow ? <Eyebrow className="mb-6">{hero.eyebrow}</Eyebrow> : null}
          <h1 className="display-xl animate-reveal">{hero.heading || "Request a Quote"}</h1>
          <RichText text={hero.body} className="lede mt-6 text-muted" />
          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
            <IfPublic path="/furniture">
              <ButtonLink href="/furniture" variant="text" arrow>
                Browse & configure
              </ButtonLink>
            </IfPublic>
            <IfPublic path="/custom-furniture">
              <ButtonLink href="/custom-furniture" variant="text" arrow>
                Custom furniture
              </ButtonLink>
            </IfPublic>
          </div>
          {hero.image ? <CmsImage image={hero.image} slot="feature" className="mt-12 hidden lg:block" sizes="35vw" /> : null}
        </div>
        <div className="lg:col-span-6 lg:col-start-7 lg:pt-4">
          {settings.quotesEnabled ? (
            <QuoteRequestForm
              defaultInterest={preset}
              suggestions={products.map((p) => p.name)}
              confirmation={{ heading: confirmation.heading, body: confirmation.body ? <RichText text={confirmation.body} className="lede mt-4 text-muted" /> : null }}
            />
          ) : (
            <div className="border border-stone bg-paper p-8">
              <h2 className="display-sm">Quote requests are paused.</h2>
              <p className="mt-3 text-muted">We&apos;re not accepting quote requests online right now. Please contact us directly.</p>
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
  );
}
