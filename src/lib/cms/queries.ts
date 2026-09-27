import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { getPageDefinition } from "./definitions";

export const mediaFields = {
  id: true,
  url: true,
  alt: true,
  width: true,
  height: true,
  focalX: true,
  focalY: true,
  blurDataUrl: true,
} as const;

export type MediaRef = {
  id: string;
  url: string;
  alt: string;
  width: number;
  height: number;
  focalX: number;
  focalY: number;
  blurDataUrl: string | null;
};

export interface SectionItemContent {
  id: string;
  eyebrow: string | null;
  title: string | null;
  body: string | null;
  image: MediaRef | null;
  linkLabel: string | null;
  linkHref: string | null;
}

export interface SectionContent {
  key: string;
  visible: boolean;
  eyebrow: string | null;
  heading: string | null;
  subheading: string | null;
  body: string | null;
  image: MediaRef | null;
  primaryCta: { label: string; href: string } | null;
  secondaryCta: { label: string; href: string } | null;
  items: SectionItemContent[];
}

export interface PageContent {
  slug: string;
  title: string;
  body: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  seoTitle: string | null;
  seoDescription: string | null;
  ogImage: MediaRef | null;
  updatedAt: Date | null;
  section: (key: string) => SectionContent;
}

function emptySection(key: string): SectionContent {
  return {
    key,
    visible: true,
    eyebrow: null,
    heading: null,
    subheading: null,
    body: null,
    image: null,
    primaryCta: null,
    secondaryCta: null,
    items: [],
  };
}

function cta(label: string | null, href: string | null) {
  return label?.trim() && href?.trim() ? { label: label.trim(), href: href.trim() } : null;
}

/** Load a CMS page with all sections. Memoized per request. */
export const getPageContent = cache(async (slug: string): Promise<PageContent> => {
  const def = getPageDefinition(slug);
  const page = await prisma.page.findUnique({
    where: { slug },
    include: {
      ogImage: { select: mediaFields },
      sections: {
        include: {
          image: { select: mediaFields },
          items: { where: { visible: true }, orderBy: { displayOrder: "asc" }, include: { image: { select: mediaFields } } },
        },
      },
    },
  });

  const map = new Map<string, SectionContent>();
  for (const s of page?.sections ?? []) {
    map.set(s.key, {
      key: s.key,
      visible: s.visible,
      eyebrow: s.eyebrow,
      heading: s.heading,
      subheading: s.subheading,
      body: s.body,
      image: s.image,
      primaryCta: cta(s.primaryCtaLabel, s.primaryCtaHref),
      secondaryCta: cta(s.secondaryCtaLabel, s.secondaryCtaHref),
      items: s.items.map((i) => ({
        id: i.id,
        eyebrow: i.eyebrow,
        title: i.title,
        body: i.body,
        image: i.image,
        linkLabel: i.linkLabel,
        linkHref: i.linkHref,
      })),
    });
  }

  return {
    slug,
    title: page?.title ?? def?.title ?? slug,
    body: page?.body ?? null,
    status: page?.status ?? "PUBLISHED",
    seoTitle: page?.seoTitle ?? null,
    seoDescription: page?.seoDescription ?? null,
    ogImage: page?.ogImage ?? null,
    updatedAt: page?.updatedAt ?? null,
    section: (key: string) => map.get(key) ?? emptySection(key),
  };
});
