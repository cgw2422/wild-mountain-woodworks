import type { Metadata } from "next";
import { RichText } from "@/components/ui/Markdown";
import { NOT_FOUND_METADATA, getVisiblePage, requireVisiblePage, withPreviewRobots } from "@/lib/cms/pages";
import { buildMetadata } from "@/lib/seo";
import { getSettings } from "@/lib/settings";
import { CmsImage } from "@/components/media/CmsImage";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { ContactForm } from "@/components/forms/ContactForm";

export async function generateMetadata(): Promise<Metadata> {
  const visible = await getVisiblePage("contact");
  if (!visible) return NOT_FOUND_METADATA;
  const page = visible.page;
  return withPreviewRobots(visible, buildMetadata({ title: page.seoTitle ?? "Contact", description: page.seoDescription, path: "/contact", image: page.ogImage }));
}

const REASONS = new Set(["PRODUCT_QUESTION", "CUSTOM_FURNITURE", "EXISTING_QUOTE", "DELIVERY_QUESTION", "OTHER"]);

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const [page, settings, sp] = await Promise.all([requireVisiblePage("contact").then((v) => v.page), getSettings(), searchParams]);
  const hero = page.section("hero");
  const details = page.section("details");
  const socials = [
    { label: "Instagram", href: settings.instagramUrl },
    { label: "Facebook", href: settings.facebookUrl },
    { label: "Pinterest", href: settings.pinterestUrl },
    { label: "Houzz", href: settings.houzzUrl },
  ].filter((s): s is { label: string; href: string } => Boolean(s.href));

  return (
    <Container size="wide" className="pb-24 pt-10 md:pb-32 md:pt-14">
      <Breadcrumbs items={[{ label: "Contact" }]} className="mb-10 md:mb-14" />
      <div className="grid gap-16 lg:grid-cols-12 lg:gap-20">
        <div className="lg:col-span-5">
          {hero.eyebrow ? <Eyebrow className="mb-6">{hero.eyebrow}</Eyebrow> : null}
          <h1 className="display-xl animate-reveal">{hero.heading || "Contact"}</h1>
          <RichText text={hero.body} className="lede mt-6 text-muted" />

          <div className="mt-12 border-t border-stone pt-8">
            {details.heading ? <h2 className="font-display text-2xl">{details.heading}</h2> : null}
            <RichText text={details.body} className="mt-2 text-muted" />
            <dl className="mt-6 space-y-4 text-[0.97rem]">
              {settings.email ? (
                <div>
                  <dt className="eyebrow text-muted">Email</dt>
                  <dd className="mt-1">
                    <a href={`mailto:${settings.email}`} className="link-quiet">
                      {settings.email}
                    </a>
                  </dd>
                </div>
              ) : null}
              {settings.phone ? (
                <div>
                  <dt className="eyebrow text-muted">Phone</dt>
                  <dd className="mt-1">
                    <a href={`tel:${settings.phone.replace(/[^+\d]/g, "")}`} className="link-quiet">
                      {settings.phone}
                    </a>
                  </dd>
                </div>
              ) : null}
              {settings.locationText || settings.serviceAreaText ? (
                <div>
                  <dt className="eyebrow text-muted">Location</dt>
                  <dd className="mt-1">{[settings.locationText, settings.serviceAreaText].filter(Boolean).join(" · ")}</dd>
                </div>
              ) : null}
              {socials.length ? (
                <div>
                  <dt className="eyebrow text-muted">Follow</dt>
                  <dd className="mt-1 flex flex-wrap gap-5">
                    {socials.map((s) => (
                      <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" className="link-quiet">
                        {s.label}
                      </a>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
          {hero.image ? <CmsImage image={hero.image} slot="feature" className="mt-12 hidden lg:block" sizes="35vw" /> : null}
        </div>
        <div className="lg:col-span-6 lg:col-start-7 lg:pt-4">
          <ContactForm defaultReason={sp.reason && REASONS.has(sp.reason) ? sp.reason : undefined} />
        </div>
      </div>
    </Container>
  );
}
