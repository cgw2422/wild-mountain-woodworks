import "server-only";
import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { mediaFields, type MediaRef } from "@/lib/cms/queries";
import { configurableProductInclude } from "@/lib/pricing/load";
import { resolveConfigurableProduct } from "@/lib/pricing/resolve";
import { startingPrice } from "@/lib/pricing/engine";
import { percentOff } from "@/lib/pricing/sale";
import type { ConfigurableProduct } from "@/lib/pricing/types";
import { getSettings } from "@/lib/settings";

/**
 * Public read models. Only ACTIVE products, PUBLISHED portfolio projects and
 * visible, non-archived categories are ever returned — unless `preview` is
 * explicitly requested by an authenticated admin preview route.
 */

export const publicProductWhere = {
  status: "ACTIVE",
  OR: [{ categoryId: null }, { category: { visible: true, archivedAt: null } }],
} satisfies Prisma.ProductWhereInput;

export const publicCategoryWhere = { visible: true, archivedAt: null } satisfies Prisma.CategoryWhereInput;

const imageInclude = {
  images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], include: { media: { select: mediaFields } } },
} satisfies Prisma.ProductInclude;

export interface ProductCardData {
  id: string;
  name: string;
  slug: string;
  shortDescription: string;
  categoryName: string | null;
  image: MediaRef | null;
  secondaryImage: MediaRef | null;
  /** null when prices are hidden (globally or per product) or unpriced. */
  startingPriceCents: number | null;
  /** The regular "from" price while a sale is active (shown struck through), else null. */
  regularPriceCents: number | null;
  /** Set only while a sale is active AND prices are shown. `percentOff` is what's advertised (e.g. 30 or 12.5). */
  sale: { label: string | null; percentOff: number } | null;
}

const cardInclude = { ...configurableProductInclude, ...imageInclude, category: true } satisfies Prisma.ProductInclude;
type CardRecord = Prisma.ProductGetPayload<{ include: typeof cardInclude }>;

function withAlt(img: { media: MediaRef; alt: string | null } | undefined): MediaRef | null {
  if (!img) return null;
  return { ...img.media, alt: img.alt?.trim() || img.media.alt };
}

/**
 * Display prices, resolved server-side at request time: an expired or
 * scheduled sale is simply absent, so nothing needs a redeploy. Sales are
 * only shown where prices are shown. The advertised discount is the entered
 * percentage for percent sales (never recalculated from the rounded price),
 * and derived from the "from" prices for fixed-price sales.
 */
function salePricing(configurable: ConfigurableProduct, visible: boolean) {
  const start = visible ? startingPrice(configurable) : null;
  const regular = visible && start != null && configurable.sale ? startingPrice(configurable, { regular: true }) : null;
  return {
    startingPriceCents: start,
    regularPriceCents: regular,
    sale:
      start != null && regular != null && regular > start
        ? { label: configurable.sale!.label, percentOff: configurable.sale!.percent ?? percentOff(regular, start) }
        : null,
  };
}

function toCard(p: CardRecord, pricesVisible: boolean, now: Date = new Date()): ProductCardData {
  const configurable = resolveConfigurableProduct(p, now);
  const visible = pricesVisible && p.showPrice;
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    shortDescription: p.shortDescription,
    categoryName: p.category?.name ?? null,
    image: withAlt(p.images[0]),
    secondaryImage: withAlt(p.images[1]),
    ...salePricing(configurable, visible),
  };
}

export const getNavCategories = cache(async () =>
  prisma.category.findMany({
    where: publicCategoryWhere,
    orderBy: { displayOrder: "asc" },
    select: { id: true, name: true, slug: true, linkUrl: true },
  }),
);

export function categoryHref(c: { slug: string; linkUrl: string | null }) {
  return c.linkUrl?.trim() || `/furniture/${c.slug}`;
}

export async function getHomepageCatalog() {
  const settings = await getSettings();
  const [categories, featured] = await Promise.all([
    prisma.category.findMany({
      where: { ...publicCategoryWhere, showOnHomepage: true },
      orderBy: { displayOrder: "asc" },
      include: { image: { select: mediaFields } },
    }),
    prisma.product.findMany({
      where: { ...publicProductWhere, featured: true },
      orderBy: [{ featuredOrder: "asc" }, { displayOrder: "asc" }],
      take: 6,
      include: cardInclude,
    }),
  ]);
  return { categories, featured: featured.map((p) => toCard(p, settings.showPrices)) };
}

export async function getCatalogProducts(categoryId?: string) {
  const settings = await getSettings();
  const products = await prisma.product.findMany({
    where: { ...publicProductWhere, ...(categoryId ? { categoryId } : {}) },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    include: cardInclude,
  });
  return products.map((p) => toCard(p, settings.showPrices));
}

/**
 * Products whose sale is running at `now`, decided in the database from the
 * sale toggle, window and prices — never from a hand-maintained list — and
 * re-checked by the pricing engine. Scheduled sales appear on their start
 * date and expired ones drop out automatically.
 */
export function activeSaleWhere(now: Date = new Date()) {
  return {
    saleEnabled: true,
    basePriceCents: { not: null },
    AND: [
      { OR: [{ saleStartsAt: null }, { saleStartsAt: { lte: now } }] },
      { OR: [{ saleEndsAt: null }, { saleEndsAt: { gt: now } }] },
      {
        OR: [
          { saleType: "FIXED_PRICE", salePriceCents: { not: null, gt: 0, lt: prisma.product.fields.basePriceCents } },
          // Percent sales derive their price from the regular price; the rare
          // case where rounding reaches the regular price is filtered out by
          // the pricing engine (getSaleProducts re-checks every card).
          { saleType: "PERCENT", salePercentBps: { gt: 0, lt: 10_000 } },
        ],
      },
    ],
  } satisfies Prisma.ProductWhereInput;
}

/** Cards for /furniture/sale: live products with an active, visible sale. */
export async function getSaleProducts(now: Date = new Date()) {
  const settings = await getSettings();
  if (!settings.showPrices) return [];
  const products = await prisma.product.findMany({
    where: { ...publicProductWhere, ...activeSaleWhere(now), showPrice: true },
    orderBy: [{ featured: "desc" }, { displayOrder: "asc" }, { createdAt: "desc" }],
    include: cardInclude,
  });
  return products.map((p) => toCard(p, true, now)).filter((c) => c.sale != null);
}

/** How many public pieces are on sale right now (for the catalog's "Sale" filter). */
export const countSaleProducts = cache(async () => {
  const settings = await getSettings();
  if (!settings.showPrices) return 0;
  return prisma.product.count({ where: { ...publicProductWhere, ...activeSaleWhere(), showPrice: true } });
});

export const getPublicCategoryBySlug = cache(async (slug: string) =>
  prisma.category.findFirst({ where: { slug, ...publicCategoryWhere }, include: { image: { select: mediaFields } } }),
);

/**
 * Full product page data. `preview` includes drafts/archived and must only
 * be used behind admin authentication.
 */
export const getProductPage = cache(async (where: { slug: string } | { id: string }, preview = false) => {
  const settings = await getSettings();
  const product = await prisma.product.findFirst({
    where: { ...where, ...(preview ? {} : publicProductWhere) },
    include: cardInclude,
  });
  if (!product) return null;

  const configurable = resolveConfigurableProduct(product);
  const pricesVisible = settings.showPrices && product.showPrice && product.basePriceCents != null;

  const [related, faqs, videos] = await Promise.all([
    prisma.product.findMany({
      where: { ...publicProductWhere, id: { not: product.id }, ...(product.categoryId ? { categoryId: product.categoryId } : {}) },
      orderBy: [{ featured: "desc" }, { displayOrder: "asc" }],
      take: 3,
      include: cardInclude,
    }),
    prisma.faq.findMany({
      where: { visible: true, archivedAt: null, showOnProductPages: true },
      orderBy: [{ category: { displayOrder: "asc" } }, { displayOrder: "asc" }],
      take: 6,
    }),
    prisma.productVideo.findMany({
      where: { productId: product.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { poster: { select: mediaFields } },
    }),
  ]);

  // Fill "related" with other pieces if the category is small.
  let relatedCards = related.map((p) => toCard(p, settings.showPrices));
  if (relatedCards.length < 3) {
    const more = await prisma.product.findMany({
      where: { ...publicProductWhere, id: { notIn: [product.id, ...related.map((r) => r.id)] } },
      orderBy: [{ featured: "desc" }, { displayOrder: "asc" }],
      take: 3 - relatedCards.length,
      include: cardInclude,
    });
    relatedCards = [...relatedCards, ...more.map((p) => toCard(p, settings.showPrices))];
  }

  return {
    product,
    images: product.images.map((i) => withAlt(i)!).filter(Boolean),
    videos: videos.map((v) => ({
      id: v.id,
      url: v.url,
      mimeType: v.mimeType,
      width: v.width,
      height: v.height,
      durationSec: v.durationSec,
      title: v.title,
      createdAt: v.createdAt,
      poster: v.poster,
    })),
    configurable,
    pricesVisible,
    ...salePricing(configurable, pricesVisible),
    saleEndsAt: pricesVisible ? (configurable.sale?.endsAt ?? null) : null,
    related: relatedCards,
    faqs,
  };
});

/* ------------------------------------------------------------ portfolio */

const portfolioImages = {
  images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], include: { media: { select: mediaFields } } },
} satisfies Prisma.PortfolioProjectInclude;

export interface PortfolioCardData {
  id: string;
  name: string;
  slug: string;
  summary: string;
  furnitureType: string | null;
  wood: string | null;
  image: MediaRef | null;
}

function toPortfolioCard(p: Prisma.PortfolioProjectGetPayload<{ include: typeof portfolioImages }>): PortfolioCardData {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    summary: p.summary,
    furnitureType: p.furnitureType,
    wood: p.wood,
    image: withAlt(p.images[0]),
  };
}

export async function getFeaturedPortfolio(take = 3) {
  const rows = await prisma.portfolioProject.findMany({
    where: { status: "PUBLISHED", featured: true },
    orderBy: [{ featuredOrder: "asc" }, { displayOrder: "asc" }],
    take,
    include: portfolioImages,
  });
  return rows.map(toPortfolioCard);
}

export async function getPortfolioList() {
  const rows = await prisma.portfolioProject.findMany({
    where: { status: "PUBLISHED" },
    orderBy: [{ displayOrder: "asc" }, { publishedAt: "desc" }],
    include: portfolioImages,
  });
  return rows.map(toPortfolioCard);
}

export const getPortfolioProject = cache(async (where: { slug: string } | { id: string }, preview = false) => {
  const project = await prisma.portfolioProject.findFirst({
    where: { ...where, ...(preview ? {} : { status: "PUBLISHED" as const }) },
    include: portfolioImages,
  });
  if (!project) return null;
  const more = await prisma.portfolioProject.findMany({
    where: { status: "PUBLISHED", id: { not: project.id } },
    orderBy: [{ featured: "desc" }, { displayOrder: "asc" }],
    take: 3,
    include: portfolioImages,
  });
  return { project, images: project.images.map((i) => withAlt(i)!), more: more.map(toPortfolioCard) };
});

/* ------------------------------------------------------------ FAQ */

export async function getFaqGroups() {
  const [categories, uncategorized] = await Promise.all([
    prisma.faqCategory.findMany({
      orderBy: { displayOrder: "asc" },
      include: { faqs: { where: { visible: true, archivedAt: null }, orderBy: { displayOrder: "asc" } } },
    }),
    prisma.faq.findMany({ where: { visible: true, archivedAt: null, categoryId: null }, orderBy: { displayOrder: "asc" } }),
  ]);
  const groups = categories
    .filter((c) => c.faqs.length > 0)
    .map((c) => ({ id: c.id, name: c.name, slug: c.slug, faqs: c.faqs }));
  if (uncategorized.length) groups.push({ id: "general", name: "General", slug: "general", faqs: uncategorized });
  return groups;
}
