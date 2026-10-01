import { getPageContent } from "@/lib/cms/queries";
import { unpublishedPagePaths } from "@/lib/cms/pages";
import type { getProductPage } from "@/lib/catalog/queries";
import { getSettings, salesFlags } from "@/lib/settings";
import { siteUrl } from "@/lib/site-url";
import { Container } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { Markdown, RichText } from "@/components/ui/Markdown";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Accordion } from "@/components/site/Accordion";
import { ProductCard } from "@/components/site/ProductCard";
import { CtaBand } from "@/components/site/CtaBand";
import { JsonLd } from "@/components/site/JsonLd";
import { SectionHeading } from "@/components/site/SectionHeading";
import { RidgeLine } from "@/components/brand/Logo";
import { isoDuration } from "@/lib/media/video";
import { lastSaleDay, siteDateInput, siteDateLabel } from "@/lib/site-time";
import { ProductGallery } from "./ProductGallery";
import { PriceTag } from "./PriceTag";
import { SaleBadge } from "./SaleBadge";
import { Configurator, type PurchaseMode } from "./Configurator";
import { PaymentOptions } from "@/components/payments/PaymentOptions";
import { paymentMessaging } from "@/lib/payments/messaging";
import { IfPublic } from "@/components/site/IfPublic";

type Data = NonNullable<Awaited<ReturnType<typeof getProductPage>>>;

export async function ProductView({ data }: { data: Data }) {
  const [settings, shared, quotePage, hidden] = await Promise.all([getSettings(), getPageContent("product"), getPageContent("request-quote"), unpublishedPagePaths()]);
  const { product, images, videos, configurable, pricesVisible, startingPriceCents, regularPriceCents, sale, saleEndsAt, related, faqs } = data;
  const flags = salesFlags(settings);
  // Sales are quote-based: every configuration becomes a quote request (no cart/checkout).
  const mode: PurchaseMode = flags.quotes ? "quote" : "contact";

  const madeToOrder = shared.section("made-to-order");
  const woodNote = shared.section("wood-note");
  const request = shared.section("request");
  const closing = shared.section("cta");
  const confirmation = quotePage.section("confirmation");
  const leadTime = product.leadTime || settings.defaultLeadTime;

  const details = [
    { id: "dimensions", title: "Dimensions", content: product.dimensions },
    { id: "materials", title: "Materials", content: product.materials },
    { id: "construction", title: "Construction & Details", content: product.construction },
    { id: "care", title: "Finish & Care", content: product.careInstructions },
    { id: "delivery", title: "Delivery", content: product.deliveryInfo },
  ].filter((d) => d.content?.trim());

  const crumbs = [
    { label: "Furniture", href: "/furniture" },
    ...(product.category && !product.category.linkUrl ? [{ label: product.category.name, href: `/furniture/${product.category.slug}` }] : []),
    { label: product.name },
  ];

  const absolute = (url: string) => (url.startsWith("http") ? url : siteUrl(url));
  const absoluteImages = images.map((i) => absolute(i.url));
  // Google needs a thumbnail for every VideoObject; fall back to the first photo.
  const videoObjects = videos
    .map((v) => ({ v, thumb: v.poster?.url ?? images[0]?.url }))
    .filter((x): x is { v: (typeof videos)[number]; thumb: string } => Boolean(x.thumb))
    .map(({ v, thumb }) => ({
      "@type": "VideoObject",
      name: v.title || `${product.name} video`,
      description: v.title || product.shortDescription || product.name,
      thumbnailUrl: absolute(thumb),
      uploadDate: v.createdAt.toISOString(),
      contentUrl: absolute(v.url),
      duration: isoDuration(v.durationSec),
    }));

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Product",
          name: product.name,
          description: product.shortDescription || undefined,
          sku: product.sku ?? undefined,
          image: absoluteImages.length ? absoluteImages : undefined,
          brand: { "@type": "Brand", name: settings.businessName },
          category: product.category?.name,
          url: siteUrl(`/furniture/${product.slug}`),
          ...(videoObjects.length ? { subjectOf: videoObjects } : {}),
          ...(startingPriceCents != null
            ? {
                offers: {
                  "@type": "Offer",
                  priceCurrency: "USD",
                  price: (startingPriceCents / 100).toFixed(2),
                  ...(regularPriceCents != null && saleEndsAt ? { priceValidUntil: siteDateInput(lastSaleDay(new Date(saleEndsAt))) } : {}),
                  availability: "https://schema.org/MadeToOrder",
                  url: siteUrl(`/furniture/${product.slug}`),
                  seller: { "@type": "Organization", name: settings.businessName },
                },
              }
            : {}),
        }}
      />

      <Container size="wide" className="pt-6 md:pt-10">
        <Breadcrumbs items={crumbs} className="mb-6 md:mb-10" />
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-14 xl:gap-20">
          <div className="lg:col-span-7">
            <div className="relative lg:sticky lg:top-28">
              {sale ? <SaleBadge label={sale.label} percentOff={sale.percentOff} size="hero" className="-left-2 sm:-left-4 lg:left-5" /> : null}
              <ProductGallery
                images={images.map((img, i) => ({ ...img, id: `${img.id}-${i}` }))}
                videos={videos.map((v) => ({
                  id: v.id,
                  url: v.url,
                  mimeType: v.mimeType,
                  width: v.width,
                  height: v.height,
                  title: v.title,
                  posterUrl: v.poster?.url ?? null,
                }))}
                productName={product.name}
              />
            </div>
          </div>

          <div className="pb-16 lg:col-span-5 lg:pb-24">
            {product.category ? <p className="eyebrow text-bronze-text">{product.category.name}</p> : null}
            <h1 className="display-lg mt-4">{product.name}</h1>
            {startingPriceCents != null ? (
              <p className="mt-4 text-lg">
                <PriceTag cents={startingPriceCents} regularCents={regularPriceCents} label={sale?.label} percent={sale?.percentOff} />
                {regularPriceCents != null && saleEndsAt ? (
                  <span className="block text-sm text-muted">Sale ends {siteDateLabel(lastSaleDay(new Date(saleEndsAt)))}</span>
                ) : null}
              </p>
            ) : null}
            {product.shortDescription ? <p className="lede mt-5 text-muted">{product.shortDescription}</p> : null}

            <div className="mt-8 flex flex-col gap-4 border-y border-stone py-5 text-sm sm:flex-row sm:gap-8">
              <div className="flex flex-1 items-start gap-3">
                <RidgeLine className="mt-1.5 h-2.5 w-7 shrink-0 text-bronze" />
                <div>
                  <p className="font-semibold">{madeToOrder.heading || "Handcrafted to order"}</p>
                  <RichText text={madeToOrder.body} className="mt-0.5 text-muted" />
                </div>
              </div>
              {leadTime ? (
                <div className="pl-10 sm:w-44 sm:shrink-0 sm:border-l sm:border-stone sm:pl-8">
                  <p className="font-semibold">Estimated lead time</p>
                  <p className="mt-0.5 text-muted">{leadTime}</p>
                </div>
              ) : null}
            </div>

            <div className="mt-10">
              <Configurator
                product={configurable}
                pricesVisible={pricesVisible}
                priceDisclaimer={settings.priceDisclaimer}
                mode={mode}
                requestCopy={{ heading: request.heading, body: request.body ? <RichText text={request.body} className="mt-3 leading-relaxed text-muted" /> : null }}
                confirmationCopy={{ heading: confirmation.heading, body: confirmation.body ? <RichText text={confirmation.body} className="mt-3 leading-relaxed text-muted" /> : null }}
                publicLinks={{ contact: !hidden.has("/contact"), privacy: !hidden.has("/privacy") }}
                paymentNote={<PaymentOptions messaging={paymentMessaging(settings, flags.onlinePayments)} />}
              />
            </div>
          </div>
        </div>
      </Container>

      {/* Details */}
      <section aria-labelledby="details-heading" className="border-t border-stone bg-paper py-20 md:py-28">
        <Container size="wide">
          <div className="grid gap-14 lg:grid-cols-12 lg:gap-20">
            <div className="lg:col-span-6">
              <h2 id="details-heading" className="display-md">
                About the {product.name.replace(/^The\s+/i, "")}
              </h2>
              <Markdown className="mt-6">{product.description || product.shortDescription}</Markdown>
            </div>
            <div className="lg:col-span-6">
              {details.length ? (
                <Accordion
                  headingLevel={3}
                  items={details.map((d, i) => ({ id: d.id, title: d.title, defaultOpen: i === 0, content: <Markdown className="text-[0.97rem]">{d.content}</Markdown> }))}
                />
              ) : null}
              {woodNote.visible && woodNote.heading ? (
                <div className="mt-10 bg-stone-light p-7">
                  <h3 className="font-display text-2xl">{woodNote.heading}</h3>
                  <RichText text={woodNote.body} className="mt-3 leading-relaxed text-muted" />
                  {woodNote.primaryCta ? (
                    <ButtonLink href={woodNote.primaryCta.href} variant="text" className="mt-4" arrow>
                      {woodNote.primaryCta.label}
                    </ButtonLink>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </Container>
      </section>

      {faqs.length ? (
        <section aria-labelledby="product-faq" className="py-20 md:py-28">
          <Container size="wide">
            <div className="grid gap-10 lg:grid-cols-12 lg:gap-20">
              <div className="lg:col-span-4">
                <h2 id="product-faq" className="display-md">
                  Questions
                </h2>
                <IfPublic path="/faq">
                  <ButtonLink href="/faq" variant="text" className="mt-6" arrow>
                    All FAQs
                  </ButtonLink>
                </IfPublic>
              </div>
              <div className="lg:col-span-8">
                <Accordion items={faqs.map((f) => ({ id: f.id, title: f.question, content: <Markdown className="text-[0.97rem]">{f.answer}</Markdown> }))} />
              </div>
            </div>
          </Container>
        </section>
      ) : null}

      {related.length ? (
        <section aria-labelledby="related-heading" className="border-t border-stone py-20 md:py-28">
          <Container size="wide">
            <SectionHeading eyebrow="You may also like" heading="More pieces" size="md" />
            <span id="related-heading" className="sr-only">
              More pieces
            </span>
            <div className="mt-12 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-10">
              {related.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      <CtaBand section={closing} />
    </>
  );
}
