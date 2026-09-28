import "server-only";
import { prisma } from "@/lib/db";
import { PAGE_DEFINITIONS, type PageDefinition } from "@/lib/cms/definitions";
import type { SectionValue } from "@/components/admin/content/types";

export const editorMediaSelect = {
  id: true,
  url: true,
  alt: true,
  width: true,
  height: true,
  focalX: true,
  focalY: true,
  originalName: true,
} as const;

/** Load a CMS page and shape every defined section for the section editor. */
export async function loadPageForEditor(def: PageDefinition) {
  const page = await prisma.page.findUnique({
    where: { slug: def.slug },
    include: {
      ogImage: { select: editorMediaSelect },
      sections: {
        include: {
          image: { select: editorMediaSelect },
          items: { orderBy: { displayOrder: "asc" }, include: { image: { select: editorMediaSelect } } },
        },
      },
    },
  });

  const sections: SectionValue[] = def.sections.map((sd) => {
    const s = page?.sections.find((row) => row.key === sd.key);
    return {
      key: sd.key,
      exists: Boolean(s),
      visible: s?.visible ?? true,
      eyebrow: s?.eyebrow ?? null,
      heading: s?.heading ?? null,
      subheading: s?.subheading ?? null,
      body: s?.body ?? null,
      image: s?.image ?? null,
      primaryCtaLabel: s?.primaryCtaLabel ?? null,
      primaryCtaHref: s?.primaryCtaHref ?? null,
      secondaryCtaLabel: s?.secondaryCtaLabel ?? null,
      secondaryCtaHref: s?.secondaryCtaHref ?? null,
      items: (s?.items ?? []).map((i) => ({
        id: i.id,
        eyebrow: i.eyebrow,
        title: i.title,
        body: i.body,
        image: i.image,
        linkLabel: i.linkLabel,
        linkHref: i.linkHref,
        visible: i.visible,
      })),
      updatedAt: s?.updatedAt.toISOString() ?? null,
    };
  });

  return { page, sections };
}

/** Common on-site destinations offered as suggestions in link fields. */
export function linkSuggestions(): string[] {
  const paths = new Set<string>(["/", "/furniture", "/custom-furniture", "/our-work", "/about", "/faq", "/contact", "/request-quote"]);
  for (const d of PAGE_DEFINITIONS) paths.add(d.path);
  return [...paths];
}
