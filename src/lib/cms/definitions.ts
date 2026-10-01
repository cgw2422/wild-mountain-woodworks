import type { ImageSlot } from "@/lib/media/slots";

/**
 * Structured CMS definitions.
 *
 * Code decides WHICH sections a page has, which fields are editable and the
 * display ratio for each image location. All copy, images, CTAs and
 * visibility live in the database (Page / PageSection / SectionItem) and are
 * edited in Admin → Homepage / Pages. Missing rows fall back to empty values,
 * so adding a section here never breaks a running site.
 */

export type SectionField =
  | "eyebrow"
  | "heading"
  | "subheading"
  | "body"
  | "image"
  | "primaryCta"
  | "secondaryCta";

export type ItemField = "eyebrow" | "title" | "body" | "image" | "link";

export interface SectionDefinition {
  key: string;
  label: string;
  help?: string;
  fields: SectionField[];
  imageSlot?: ImageSlot;
  imageHelp?: string;
  /** Whether admins may hide this section. */
  hideable?: boolean;
  items?: {
    label: string; // singular, e.g. "Step"
    fields: ItemField[];
    imageSlot?: ImageSlot;
    max?: number;
  };
}

export interface PageDefinition {
  slug: string;
  title: string;
  /** Public path, used for "View page" links and sitemap. */
  path: string;
  /** system/policy: defined here in code. custom: created in Admin → Pages (see customPageDefinition). */
  kind: "system" | "policy" | "custom";
  description: string;
  /**
   * A shared content block rendered inside other pages (e.g. the product
   * and project page sections), not a standalone public page. Templates
   * have no URL of their own, so they have no status, menu link or sitemap
   * entry.
   */
  template?: boolean;
  /** The homepage. Always published: drafting it would take the whole site offline. */
  siteRoot?: boolean;
  /** Extra caution shown before this page is unpublished (never blocks it). */
  unpublishWarning?: string;
  /** Policy/content pages have a markdown body. */
  hasBody?: boolean;
  sections: SectionDefinition[];
}

const hero = (overrides: Partial<SectionDefinition> = {}): SectionDefinition => ({
  key: "hero",
  label: "Page header",
  fields: ["eyebrow", "heading", "body", "image"],
  imageSlot: "banner",
  imageHelp: "Optional. Displayed wide behind or beside the page title.",
  ...overrides,
});

const policyPage = (slug: string, title: string, description: string): PageDefinition => ({
  slug,
  title,
  path: `/${slug}`,
  kind: "policy",
  description,
  hasBody: true,
  sections: [hero({ fields: ["eyebrow", "heading", "body", "image"], imageHelp: "Optional header image." })],
});

export const PAGE_DEFINITIONS: PageDefinition[] = [
  {
    slug: "home",
    title: "Homepage",
    path: "/",
    kind: "system",
    siteRoot: true,
    description: "The homepage, organized by section.",
    sections: [
      {
        key: "hero",
        label: "Hero",
        fields: ["eyebrow", "heading", "body", "image", "primaryCta", "secondaryCta"],
        imageSlot: "hero",
        imageHelp: "Wide landscape photograph. Cropped to 16:9 on desktop and 4:5 on phones around the focal point.",
        hideable: true,
      },
      {
        key: "categories",
        label: "Categories",
        help: "Which categories appear is set under Categories → “Show on homepage”.",
        fields: ["eyebrow", "heading", "subheading"],
        hideable: true,
      },
      {
        key: "featured",
        label: "Featured furniture",
        help: "Choose products with the Featured Furniture picker below.",
        fields: ["eyebrow", "heading", "subheading", "primaryCta"],
        hideable: true,
      },
      {
        key: "custom",
        label: "Custom furniture",
        fields: ["eyebrow", "heading", "body", "image", "primaryCta"],
        imageSlot: "feature",
        hideable: true,
      },
      {
        key: "craftsmanship",
        label: "Craftsmanship",
        fields: ["eyebrow", "heading", "subheading", "image"],
        imageSlot: "landscape",
        imageHelp: "Optional detail photograph shown beside the pillars.",
        hideable: true,
        items: { label: "Pillar", fields: ["title", "body"], max: 6 },
      },
      {
        key: "work",
        label: "Our Work preview",
        help: "Choose projects with the Featured Projects picker below.",
        fields: ["eyebrow", "heading", "subheading", "primaryCta"],
        hideable: true,
      },
      {
        key: "about",
        label: "About",
        fields: ["eyebrow", "heading", "body", "image", "primaryCta"],
        imageSlot: "feature",
        imageHelp: "A great place for a photograph of the shop or the maker at work.",
        hideable: true,
      },
      {
        key: "final-cta",
        label: "Closing call to action",
        fields: ["eyebrow", "heading", "body", "image", "primaryCta"],
        imageSlot: "banner",
        imageHelp: "Background image, darkened for legibility. Optional.",
        hideable: true,
      },
    ],
  },
  {
    slug: "furniture",
    unpublishWarning: "This is the catalog landing page that breadcrumbs and menus point to. Individual product pages stay live.",
    title: "Furniture catalog",
    path: "/furniture",
    kind: "system",
    description: "Header for the furniture catalog.",
    sections: [hero({ imageHelp: "Optional wide image above the catalog." }), {
      key: "custom-cta",
      label: "Custom build prompt",
      fields: ["heading", "body", "primaryCta"],
      hideable: true,
    }],
  },
  {
    slug: "sale",
    title: "Sale collection",
    path: "/furniture/sale",
    kind: "system",
    description: "Header for /furniture/sale, which lists every piece whose sale is running right now (set per product in Products → Pricing).",
    sections: [
      hero({ imageHelp: "Optional wide image above the sale collection." }),
      {
        key: "empty",
        label: "When nothing is on sale",
        help: "Shown when no sale is running. The page is also hidden from search engines then.",
        fields: ["heading", "body", "primaryCta"],
      },
    ],
  },
  {
    slug: "custom-furniture",
    title: "Custom Furniture",
    path: "/custom-furniture",
    kind: "system",
    description: "Custom furniture landing page and build form.",
    sections: [
      hero({ fields: ["eyebrow", "heading", "body", "image", "primaryCta"], imageSlot: "hero", imageHelp: "Wide landscape photograph." }),
      { key: "intro", label: "Introduction", fields: ["eyebrow", "heading", "body", "image"], imageSlot: "feature", hideable: true },
      {
        key: "process",
        label: "Process",
        fields: ["eyebrow", "heading", "subheading"],
        hideable: true,
        items: { label: "Step", fields: ["title", "body"], max: 6 },
      },
      {
        key: "possibilities",
        label: "What can be customized",
        fields: ["eyebrow", "heading", "subheading", "image"],
        imageSlot: "landscape",
        hideable: true,
        items: { label: "Possibility", fields: ["title", "body"], max: 8 },
      },
      {
        key: "gallery",
        label: "Image gallery",
        fields: ["heading"],
        hideable: true,
        items: { label: "Image", fields: ["image", "title"], imageSlot: "square", max: 8 },
      },
      { key: "form", label: "Build form introduction", fields: ["eyebrow", "heading", "body"] },
    ],
  },
  {
    slug: "our-work",
    title: "Our Work",
    path: "/our-work",
    kind: "system",
    description: "Portfolio landing page header and closing prompt.",
    sections: [
      hero(),
      { key: "cta", label: "Closing call to action", fields: ["heading", "body", "primaryCta", "image"], imageSlot: "banner", hideable: true },
    ],
  },
  {
    slug: "portfolio-project",
    title: "Portfolio project pages",
    path: "/our-work",
    template: true,
    kind: "system",
    description: "Shared call to action shown on every portfolio project.",
    sections: [{ key: "cta", label: "“Want something similar?” prompt", fields: ["eyebrow", "heading", "body", "primaryCta"] }],
  },
  {
    slug: "product",
    title: "Product pages",
    path: "/furniture",
    template: true,
    kind: "system",
    description: "Shared content shown on every product page.",
    sections: [
      { key: "made-to-order", label: "Handcrafted-to-order note", help: "Short line shown near the configurator.", fields: ["heading", "body"] },
      { key: "wood-note", label: "Natural wood characteristics", fields: ["heading", "body", "primaryCta"], hideable: true },
      { key: "request", label: "Request panel note", help: "Shown above the contact form after “Request this configuration”.", fields: ["heading", "body"] },
      { key: "cta", label: "Closing custom prompt", fields: ["heading", "body", "primaryCta", "image"], imageSlot: "banner", hideable: true },
    ],
  },
  {
    slug: "about",
    title: "About",
    path: "/about",
    kind: "system",
    description: "Company story page.",
    sections: [
      hero({ imageSlot: "hero", imageHelp: "Wide landscape photograph." }),
      { key: "intro", label: "Introduction", fields: ["eyebrow", "heading", "body", "image"], imageSlot: "feature", hideable: true },
      {
        key: "why",
        label: "Why handcrafted",
        fields: ["eyebrow", "heading", "body"],
        hideable: true,
        items: { label: "Principle", fields: ["title", "body"], max: 6 },
      },
      { key: "craftsmanship", label: "Craftsmanship", fields: ["eyebrow", "heading", "body", "image"], imageSlot: "landscape", hideable: true },
      {
        key: "workshop",
        label: "Workshop gallery",
        fields: ["eyebrow", "heading", "subheading"],
        hideable: true,
        items: { label: "Photo", fields: ["image", "title"], imageSlot: "portfolioCard", max: 9 },
      },
      { key: "maker", label: "The maker", fields: ["eyebrow", "heading", "body", "image"], imageSlot: "feature", hideable: true },
      { key: "cta", label: "Closing call to action", fields: ["heading", "body", "primaryCta", "secondaryCta", "image"], imageSlot: "banner", hideable: true },
    ],
  },
  {
    slug: "faq",
    title: "FAQ",
    path: "/faq",
    kind: "system",
    description: "FAQ page header and closing prompt. Questions are managed under FAQs.",
    sections: [hero(), { key: "cta", label: "Still have questions?", fields: ["heading", "body", "primaryCta"], hideable: true }],
  },
  {
    slug: "contact",
    unpublishWarning: "Customers use this page to reach you, and quote and order pages link to it.",
    title: "Contact",
    path: "/contact",
    kind: "system",
    description: "Contact page. Email, phone and location come from Settings.",
    sections: [hero({ imageSlot: "feature", imageHelp: "Optional portrait image beside the form." }), { key: "details", label: "Contact details panel", fields: ["heading", "body"] }],
  },
  {
    slug: "request-quote",
    unpublishWarning: "This is the general quote request form. Product configurators keep working, but the “Request a Quote” page and its header button go away.",
    title: "Request a Quote",
    path: "/request-quote",
    kind: "system",
    description: "General quote request page.",
    sections: [hero({ imageSlot: "feature", imageHelp: "Optional portrait image beside the form." }), { key: "confirmation", label: "Confirmation message", help: "Shown after any quote is submitted.", fields: ["heading", "body"] }],
  },
  policyPage("shipping-delivery", "Shipping & Delivery", "Delivery policy."),
  policyPage("returns-cancellations", "Returns & Cancellations", "Returns and cancellation policy."),
  policyPage("warranty", "Furniture Warranty", "Warranty terms."),
  policyPage("wood-characteristics", "Wood Characteristics & Natural Variation", "Educational page about natural wood."),
  policyPage("furniture-care", "Furniture Care", "Care instructions."),
  {
    ...policyPage("privacy", "Privacy Policy", "Privacy policy."),
    unpublishWarning: "Forms on the site link to the privacy policy, and many visitors (and some laws) expect one to be available while you collect personal details.",
  },
  {
    ...policyPage("terms", "Terms & Conditions", "Terms and conditions."),
    unpublishWarning: "Your terms are referenced by quotes and invoices. Customers won't be able to read them while the page is unpublished.",
  },
];

export function getPageDefinition(slug: string): PageDefinition | undefined {
  return PAGE_DEFINITIONS.find((p) => p.slug === slug);
}

export const POLICY_SLUGS = PAGE_DEFINITIONS.filter((p) => p.kind === "policy").map((p) => p.slug);

/**
 * Pages created in Admin → Pages all share this template: a page header, the
 * main text (Markdown), an optional feature block and an optional
 * call-to-action band. Public at /{slug}.
 */
export const CUSTOM_PAGE_SECTIONS: SectionDefinition[] = [
  hero({ imageHelp: "Optional wide image in the page header." }),
  {
    key: "feature",
    label: "Feature block",
    help: "Optional image-and-text block below the main text.",
    fields: ["eyebrow", "heading", "body", "image", "primaryCta"],
    imageSlot: "feature",
    hideable: true,
  },
  {
    key: "cta",
    label: "Call to action",
    help: "Optional closing band with a button.",
    fields: ["heading", "body", "primaryCta"],
    hideable: true,
  },
];

/**
 * Every standalone public page can be Draft, Published or Archived: all
 * code-defined pages with their own URL and every page created in admin.
 * Only the homepage (the site root) and shared content blocks (templates)
 * are exempt — there is no allow-list to maintain.
 */
export function canChangeStatus(def: Pick<PageDefinition, "template" | "siteRoot">): boolean {
  return !def.template && !def.siteRoot;
}

export function customPageDefinition(page: { slug: string; title: string }): PageDefinition {
  return {
    slug: page.slug,
    title: page.title,
    path: `/${page.slug}`,
    kind: "custom",
    description: "Page created in the admin.",
    hasBody: true,
    sections: CUSTOM_PAGE_SECTIONS,
  };
}

/**
 * Slugs a custom page can never use: every top-level route, code-defined
 * page, and reserved system path.
 */
export const RESERVED_PAGE_SLUGS = new Set([
  ...PAGE_DEFINITIONS.map((p) => p.slug),
  ...PAGE_DEFINITIONS.map((p) => p.path.split("/")[1]).filter(Boolean),
  "admin", "api", "media-files", "cart", "checkout", "order", "orders", "quote", "quotes", "invoice", "invoices", "account", "login", "logout",
  "search", "preview", "sitemap.xml", "robots.txt", "manifest.webmanifest", "icon.svg", "apple-icon.png",
  "favicon.ico", "brand", "_next", "static", "new",
]);
