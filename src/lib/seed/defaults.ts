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
 *   - admin accounts are never modified: the first owner is created only
 *     when there are no admin users at all.
 *
 * No products, sample content, media or storage writes happen here.
 */
import type { Prisma } from "@/generated/prisma/client";
import { PAGE_DEFINITIONS } from "@/lib/cms/definitions";
import { createPasswordAdmin } from "@/lib/auth/accounts";
import { validatePasswordStrength } from "@/lib/auth/password";
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
  ecommerceEnabled: false,
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

/** Everything the application requires, insert-only. Returns how many records were created. */
export async function applyRequiredDefaults(db: Db, log: Log, env: Record<string, string | undefined> = process.env): Promise<number> {
  return (
    (await ensureSettings(db, log)) +
    (await ensurePages(db, log)) +
    (await ensureStarterAnnouncement(db, log)) +
    (await bootstrapFirstOwner(db, log, env))
  );
}
