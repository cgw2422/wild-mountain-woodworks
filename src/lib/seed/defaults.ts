/**
 * Required default content — the records the application needs to exist,
 * shared by the production seed (scripts/seed-production.ts, run on every
 * Railway deploy) and the development seed (prisma/seed.ts).
 *
 * Every function here is INSERT-ONLY and idempotent:
 *   - it creates a record only when it is missing, and never updates or
 *     deletes anything, so owner edits to settings, pages, sections and
 *     announcements always survive;
 *   - one-time starter content (e.g. the starter announcement) is recorded in
 *     SeedMarker, so it is never re-created after the owner deletes it;
 *   - a newly added setting may be given starting text once, only while it
 *     is still empty (also recorded in SeedMarker);
 *   - admin accounts are never modified: the first owner is created only
 *     when there are no admin users at all.
 *
 * No products, sample content, media or storage writes happen here.
 */
import type { Prisma } from "@/generated/prisma/client";
import { PAGE_DEFINITIONS } from "@/lib/cms/definitions";
import { createPasswordAdmin } from "@/lib/auth/accounts";
import { validatePasswordStrength } from "@/lib/auth/password";
import { EMAIL_TEMPLATES } from "@/lib/email/template-definitions";
import { SEED_PAGES } from "../../../prisma/seed-data/pages";

type Db = Prisma.TransactionClient;
type Log = (message: string) => void;

export const DEFAULT_SETTINGS = {
  id: "default",
  businessName: "Wild Mountain Woodworks",
  tagline: "Built by hand. Made to belong.",
  brandStatement: "Handcrafted furniture built one piece at a time in Ohio.",
  locationText: "Ohio",
  serviceAreaText: "Handcrafted in Ohio.",
  addressRegion: "OH",
  defaultSeoTitle: "Wild Mountain Woodworks — Handcrafted Furniture Built in Ohio",
  defaultSeoDescription: "Handcrafted dining tables, benches, consoles and custom furniture, built one piece at a time in Ohio.",
  defaultLeadTime: "Lead time confirmed with your quote",
  priceDisclaimer: "Estimated price. Your final price is confirmed in your quote.",
  quoteConfirmationText:
    "Thank you for your request. We review every request personally and will follow up with a confirmed quote, lead time and delivery details.",
  showPrices: true,
  quotesEnabled: true,
  customOrdersEnabled: true,
  stripeInvoicingEnabled: false,
} satisfies Prisma.SiteSettingCreateInput;

/** The settings row, created with launch defaults only if it doesn't exist. Never updated. */
export async function ensureSettings(db: Db, log: Log): Promise<number> {
  const existing = await db.siteSetting.findUnique({ where: { id: "default" }, select: { id: true } });
  if (existing) return 0;
  await db.siteSetting.create({ data: DEFAULT_SETTINGS });
  log("created site settings with launch defaults");
  return 1;
}

/**
 * Every CMS page and section defined in src/lib/cms/definitions.ts, created
 * with default copy when missing. Existing pages/sections are never touched.
 * `resolveImage` is only used by the development seed for sample imagery.
 */
export async function ensurePages(db: Db, log: Log, resolveImage?: (key: string) => Promise<string | null>): Promise<number> {
  let created = 0;
  const image = async (key: string | undefined) => (key && resolveImage ? resolveImage(key) : null);
  for (const def of PAGE_DEFINITIONS) {
    const seed = SEED_PAGES.find((p) => p.slug === def.slug);
    let page = await db.page.findUnique({ where: { slug: def.slug }, include: { sections: { select: { key: true } } } });
    if (!page) {
      page = await db.page.create({
        data: {
          slug: def.slug,
          title: seed?.title ?? def.title,
          body: seed?.body ?? null,
          seoTitle: seed?.seoTitle ?? null,
          seoDescription: seed?.seoDescription ?? null,
          reviewRequired: seed?.reviewRequired ?? false,
          reviewNotes: seed?.reviewNotes ?? null,
          status: "PUBLISHED",
        },
        include: { sections: { select: { key: true } } },
      });
      log(`created page "${def.slug}"`);
      created++;
    }
    for (const [index, sdef] of def.sections.entries()) {
      if (page.sections.some((s) => s.key === sdef.key)) continue;
      const s = seed?.sections.find((x) => x.key === sdef.key);
      await db.pageSection.create({
        data: {
          pageId: page.id,
          key: sdef.key,
          displayOrder: index,
          visible: s?.visible ?? true,
          eyebrow: s?.eyebrow ?? null,
          heading: s?.heading ?? null,
          subheading: s?.subheading ?? null,
          body: s?.body ?? null,
          imageId: await image(s?.image),
          primaryCtaLabel: s?.primaryCta?.[0] ?? null,
          primaryCtaHref: s?.primaryCta?.[1] ?? null,
          secondaryCtaLabel: s?.secondaryCta?.[0] ?? null,
          secondaryCtaHref: s?.secondaryCta?.[1] ?? null,
          items: s?.items
            ? {
                create: await Promise.all(
                  s.items.map(async (it, i) => ({
                    eyebrow: it.eyebrow ?? null,
                    title: it.title ?? null,
                    body: it.body ?? null,
                    imageId: await image(it.image),
                    displayOrder: i,
                  })),
                ),
              }
            : undefined,
        },
      });
      log(`created section "${def.slug}/${sdef.key}"`);
      created++;
    }
  }
  return created;
}

/** Run `fn` once per database, ever. Returns whether it ran. */
async function once(db: Db, key: string, fn: () => Promise<void>): Promise<boolean> {
  if (await db.seedMarker.findUnique({ where: { key } })) return false;
  await fn();
  await db.seedMarker.create({ data: { key } });
  return true;
}

/**
 * A switched-off starter announcement to edit in Admin → Promotions. Offered
 * once: skipped if announcements already exist, and never re-created after
 * the owner deletes it.
 */
export async function ensureStarterAnnouncement(db: Db, log: Log): Promise<number> {
  let created = 0;
  await once(db, "starter-announcement", async () => {
    if ((await db.announcement.count()) > 0) return;
    await db.announcement.create({
      data: {
        name: "Fall Sale",
        enabled: false,
        message: "Fall Sale — Up to 30% Off Select Furniture",
        linkText: "Shop the sale",
        linkUrl: "/furniture/sale",
      },
    });
    log("created starter announcement (switched off)");
    created = 1;
  });
  return created;
}

/**
 * Controlled bootstrap of the FIRST owner, from ADMIN_EMAIL/ADMIN_PASSWORD,
 * only while no admin user exists at all. Existing admins are never created,
 * changed, reset or re-activated — so leftover variables can't recreate or
 * take over an account later.
 */
export async function bootstrapFirstOwner(db: Db, log: Log, env: Record<string, string | undefined> = process.env): Promise<number> {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.ADMIN_PASSWORD;
  const admins = await db.adminUser.count();
  if (admins > 0) {
    if (password) log("NOTE: admin accounts already exist, so ADMIN_PASSWORD is ignored. You can delete ADMIN_EMAIL/ADMIN_PASSWORD from the service variables.");
    return 0;
  }
  if (!email || !password) {
    log('No admin users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD and redeploy, or run: npm run admin:create -- --email you@example.com --name "Your Name"');
    return 0;
  }
  const problem = validatePasswordStrength(password);
  if (problem) throw new Error(`ADMIN_PASSWORD is too weak: ${problem}`);
  await createPasswordAdmin(db, { email, name: env.ADMIN_NAME?.trim() || "Owner", role: "OWNER" }, password);
  log(`created first owner ${email} (two-factor setup required at first sign-in)`);
  return 1;
}

type StarterItem = { page?: string; label?: string; url?: string };

/**
 * Starter menus matching the site's original header and footer. Each menu is
 * created once (tracked in SeedMarker): if it already exists, or the owner
 * later empties or edits it, it is never touched again. Items point at pages
 * by id, so they hide automatically while a page is a draft.
 */
const STARTER_MENUS: Array<{ key: string; name: string; title: string | null; items: StarterItem[]; categories?: boolean }> = [
  {
    key: "MAIN",
    name: "Main navigation",
    title: null,
    items: [
      { page: "furniture", label: "Furniture" },
      { page: "our-work", label: "Our Work" },
      { page: "custom-furniture", label: "Custom Furniture" },
      { page: "about", label: "About" },
      { page: "faq", label: "FAQ" },
      { page: "contact", label: "Contact" },
    ],
  },
  { key: "FOOTER", name: "Footer navigation", title: "Furniture", items: [{ page: "furniture", label: "All Furniture" }], categories: true },
  {
    key: "COMPANY",
    name: "Company menu",
    title: "Company",
    items: [
      { page: "about", label: "About" },
      { page: "our-work", label: "Our Work" },
      { page: "custom-furniture", label: "Custom Furniture" },
      { page: "contact", label: "Contact" },
    ],
  },
  {
    key: "CUSTOMER_CARE",
    name: "Customer Care menu",
    title: "Customer Care",
    items: [
      { page: "faq", label: "FAQ" },
      { page: "furniture-care", label: "Furniture Care" },
      { page: "wood-characteristics", label: "Wood Characteristics" },
      { page: "shipping-delivery", label: "Shipping & Delivery" },
      { page: "returns-cancellations", label: "Returns & Cancellations" },
      { page: "warranty", label: "Warranty" },
    ],
  },
  {
    key: "LEGAL",
    name: "Legal links",
    title: null,
    items: [
      { page: "privacy", label: "Privacy" },
      { page: "terms", label: "Terms" },
    ],
  },
];

export async function ensureMenus(db: Db, log: Log): Promise<number> {
  let created = 0;
  for (const m of STARTER_MENUS) {
    await once(db, `menu:${m.key}`, async () => {
      if (await db.menu.findUnique({ where: { key: m.key } })) return;
      const menu = await db.menu.create({ data: { key: m.key, name: m.name, title: m.title } });
      let order = 0;
      for (const it of m.items) {
        const page = it.page ? await db.page.findUnique({ where: { slug: it.page }, select: { id: true } }) : null;
        if (it.page && !page) continue;
        await db.menuItem.create({
          data: {
            menuId: menu.id,
            type: page ? "INTERNAL_PAGE" : "CUSTOM_INTERNAL_LINK",
            label: it.label ?? "",
            url: it.url ?? null,
            pageId: page?.id ?? null,
            displayOrder: order++,
          },
        });
      }
      if (m.categories) {
        const cats = await db.category.findMany({ where: { archivedAt: null, linkUrl: null }, orderBy: { displayOrder: "asc" }, select: { id: true } });
        for (const c of cats) await db.menuItem.create({ data: { menuId: menu.id, type: "PRODUCT_CATEGORY", categoryId: c.id, displayOrder: order++ } });
      }
      log(`created starter menu "${m.name}"`);
      created++;
    });
  }
  return created;
}

/**
 * Editable email templates (Admin → Settings → Emails): any template key
 * that doesn't exist yet is created with its starting text. Existing
 * templates are never changed.
 */
export async function ensureEmailTemplates(db: Db, log: Log): Promise<number> {
  const existing = new Set((await db.emailTemplate.findMany({ select: { key: true } })).map((t) => t.key));
  let created = 0;
  for (const t of EMAIL_TEMPLATES) {
    if (existing.has(t.key)) continue;
    await db.emailTemplate.create({ data: { key: t.key, name: t.name, subject: t.subject, heading: t.heading, body: t.body, buttonLabel: t.buttonLabel } });
    created++;
  }
  if (created) log(`created ${created} email template(s)`);
  return created;
}

export const DEFAULT_QUOTE_TERMS = `- Prices are valid until the expiration date shown on this quote.
- Your piece is scheduled into the shop once the deposit is received. The remaining balance is due before delivery.
- Lead times are estimates and are confirmed when your deposit is received.
- Solid wood is a natural material: grain, color and character vary from board to board and from any photos or samples.
- Changes after acceptance may affect price and lead time and are confirmed in writing.`;

/**
 * Starting quote terms, filled in once (tracked in SeedMarker) and only if
 * the owner hasn't written their own. Never changed after that.
 */
export async function ensureSalesDefaults(db: Db, log: Log): Promise<number> {
  let changed = 0;
  await once(db, "sales-default-terms", async () => {
    const res = await db.siteSetting.updateMany({ where: { id: "default", defaultQuoteTerms: null }, data: { defaultQuoteTerms: DEFAULT_QUOTE_TERMS } });
    if (res.count) {
      log("added starter quote terms");
      changed = 1;
    }
  });
  return changed;
}

/** Everything the application requires, insert-only. Returns how many records were created. */
export async function applyRequiredDefaults(db: Db, log: Log, env: Record<string, string | undefined> = process.env): Promise<number> {
  return (
    (await ensureSettings(db, log)) +
    (await ensurePages(db, log)) +
    (await ensureStarterAnnouncement(db, log)) +
    (await ensureMenus(db, log)) +
    (await ensureEmailTemplates(db, log)) +
    (await ensureSalesDefaults(db, log)) +
    (await bootstrapFirstOwner(db, log, env))
  );
}
