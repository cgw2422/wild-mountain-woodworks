/**
 * Database seed.
 *
 *   npx prisma db seed            (also runs automatically after `prisma migrate reset`)
 *
 * Always (idempotent, never overwrites edits):
 *   - site settings row with launch feature flags
 *     (E-commerce OFF, Quotes ON, Custom Orders ON)
 *   - every CMS page and section defined in code
 *   - an owner account from ADMIN_EMAIL / ADMIN_PASSWORD, if provided and
 *     no admin with that email exists
 *
 * Sample content (only into an empty catalog, unless SEED_SAMPLE_CONTENT=false):
 *   - sample products, option library, add-ons, categories, portfolio, FAQs
 *   - generated placeholder imagery, stored through the normal storage driver
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createStorageFromEnv } from "../src/lib/storage/factory";
import { hashPassword, validatePasswordStrength } from "../src/lib/auth/password";
import { PAGE_DEFINITIONS } from "../src/lib/cms/definitions";
import { renderScene } from "./seed-data/images";
import { SEED_PAGES } from "./seed-data/pages";
import { ADD_ONS, CATEGORIES, FAQS, FAQ_CATEGORIES, IMAGE_SPECS, OPTION_GROUPS, PORTFOLIO, PRODUCTS, PRODUCT_TEXT } from "./seed-data/catalog";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const storage = createStorageFromEnv();
const log = (...a: unknown[]) => console.log("[seed]", ...a);

/* ------------------------------------------------------------ images */

const mediaCache = new Map<string, string>();

async function sampleMedia(key: string): Promise<string> {
  const cached = mediaCache.get(key);
  if (cached) return cached;
  const spec = IMAGE_SPECS[key];
  if (!spec) throw new Error(`Unknown sample image: ${key}`);
  const existing = await prisma.media.findFirst({ where: { originalName: spec.name, isSample: true } });
  if (existing) {
    mediaCache.set(key, existing.id);
    return existing.id;
  }
  const buffer = await renderScene(spec.scene);
  const meta = await sharp(buffer).metadata();
  const blur = await sharp(buffer).resize(16, 16, { fit: "inside" }).webp({ quality: 40 }).toBuffer();
  const id = randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "x");
  const storageKey = `media/sample/${id}-${spec.name}`;
  await storage.put(storageKey, buffer, "image/jpeg");
  const media = await prisma.media.create({
    data: {
      storageKey,
      url: storage.publicUrl(storageKey),
      filename: storageKey.split("/").pop()!,
      originalName: spec.name,
      mimeType: "image/jpeg",
      size: buffer.length,
      width: meta.width!,
      height: meta.height!,
      alt: spec.alt,
      blurDataUrl: `data:image/webp;base64,${blur.toString("base64")}`,
      isSample: true,
    },
  });
  mediaCache.set(key, media.id);
  return media.id;
}

/** Render all sample images up front, a few at a time. */
async function prerenderImages(keys: string[]) {
  const queue = [...new Set(keys)];
  let done = 0;
  const workers = Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const k = queue.shift()!;
      await sampleMedia(k);
      done++;
      if (done % 10 === 0) log(`  images: ${done}/${keys.length}`);
    }
  });
  await Promise.all(workers);
}

/* ------------------------------------------------------------ settings */

async function ensureSettings() {
  await prisma.siteSetting.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      businessName: "Wild Mountain Woodworks",
      tagline: "Built by hand. Made to belong.",
      brandStatement: "Handcrafted furniture built one piece at a time in Ohio.",
      locationText: "Ohio",
      serviceAreaText: "Handcrafted in Ohio.",
      addressRegion: "OH",
      defaultSeoTitle: "Wild Mountain Woodworks — Handcrafted Furniture Built in Ohio",
      defaultSeoDescription:
        "Handcrafted dining tables, benches, consoles and custom furniture, built one piece at a time in Ohio.",
      defaultLeadTime: "Lead time confirmed with your quote",
      priceDisclaimer: "Estimated price. Your final price is confirmed in your quote.",
      quoteConfirmationText:
        "Thank you for your request. We review every request personally and will follow up with a confirmed quote, lead time and delivery details.",
      showPrices: true,
      quotesEnabled: true,
      customOrdersEnabled: true,
      ecommerceEnabled: false,
    },
  });
  log("settings ok");
}

/* ------------------------------------------------------------ pages */

async function ensurePages(withImages: boolean) {
  for (const def of PAGE_DEFINITIONS) {
    const seed = SEED_PAGES.find((p) => p.slug === def.slug);
    let page = await prisma.page.findUnique({ where: { slug: def.slug }, include: { sections: true } });
    if (!page) {
      page = await prisma.page.create({
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
        include: { sections: true },
      });
    }
    for (const [index, sdef] of def.sections.entries()) {
      if (page.sections.some((s) => s.key === sdef.key)) continue;
      const s = seed?.sections.find((x) => x.key === sdef.key);
      await prisma.pageSection.create({
        data: {
          pageId: page.id,
          key: sdef.key,
          displayOrder: index,
          visible: s?.visible ?? true,
          eyebrow: s?.eyebrow ?? null,
          heading: s?.heading ?? null,
          subheading: s?.subheading ?? null,
          body: s?.body ?? null,
          imageId: withImages && s?.image ? await sampleMedia(s.image) : null,
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
                    imageId: withImages && it.image ? await sampleMedia(it.image) : null,
                    displayOrder: i,
                  })),
                ),
              }
            : undefined,
        },
      });
    }
  }
  log("pages ok");
}

/* ------------------------------------------------------------ admin */

async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    const count = await prisma.adminUser.count();
    if (count === 0) log("No admin users yet. Create one with: npm run admin:create -- --email you@example.com --name \"Your Name\"");
    return;
  }
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) return;
  const problem = validatePasswordStrength(password);
  if (problem) throw new Error(`ADMIN_PASSWORD is too weak: ${problem}`);
  await prisma.adminUser.create({
    data: { email, name: process.env.ADMIN_NAME?.trim() || "Owner", passwordHash: await hashPassword(password), role: "OWNER" },
  });
  log(`created owner account ${email}`);
}

/* ------------------------------------------------------------ sample catalog */

async function seedSampleCatalog() {
  const dollars = (n: number) => Math.round(n * 100);

  // Option library
  const groupIds: Record<string, string> = {};
  const valueIds: Record<string, Record<string, string>> = {};
  for (const [gi, g] of OPTION_GROUPS.entries()) {
    const group = await prisma.optionGroup.create({
      data: {
        name: g.name,
        displayName: g.displayName,
        description: g.description ?? null,
        inputType: g.inputType,
        required: g.required ?? true,
        displayOrder: gi,
        values: {
          create: await Promise.all(
            g.values.map(async (v, i) => ({
              name: v.name,
              displayName: v.displayName ?? v.name,
              description: v.description ?? null,
              priceModifierCents: dollars(v.price),
              imageId: v.image ? await sampleMedia(v.image) : null,
              swatchColor: v.swatch ?? null,
              isCustom: v.isCustom ?? false,
              displayOrder: i,
            })),
          ),
        },
      },
      include: { values: true },
    });
    groupIds[g.key] = group.id;
    valueIds[g.key] = Object.fromEntries(group.values.map((v) => [v.name, v.id]));
  }
  log("option library ok");

  // Add-ons
  const addOnIds: Record<string, string> = {};
  for (const [i, a] of ADD_ONS.entries()) {
    const created = await prisma.addOn.create({
      data: {
        name: a.name,
        description: a.description,
        priceCents: dollars(a.price),
        maxQuantity: a.maxQuantity ?? 1,
        scope: a.scope ?? "REUSABLE",
        active: a.active ?? true,
        displayOrder: i,
        imageId: a.image ? await sampleMedia(a.image) : null,
      },
    });
    addOnIds[a.key] = created.id;
  }
  log("add-ons ok");

  // Categories
  const categoryIds: Record<string, string> = {};
  for (const [i, c] of CATEGORIES.entries()) {
    const created = await prisma.category.create({
      data: {
        name: c.name,
        slug: c.slug,
        description: c.description,
        imageId: await sampleMedia(c.image),
        linkUrl: c.linkUrl ?? null,
        displayOrder: i,
        visible: true,
        showOnHomepage: c.homepage,
      },
    });
    categoryIds[c.slug] = created.id;
  }
  log("categories ok");

  // Products
  for (const [i, p] of PRODUCTS.entries()) {
    const product = await prisma.product.create({
      data: {
        name: p.name,
        slug: p.slug,
        sku: p.sku,
        status: p.status,
        categoryId: categoryIds[p.category],
        shortDescription: p.short,
        description: p.description,
        basePriceCents: dollars(p.basePrice),
        showPrice: true,
        featured: p.featured ?? false,
        featuredOrder: i,
        leadTime: p.leadTime,
        dimensions: p.dimensions,
        materials: p.materials,
        construction: PRODUCT_TEXT.construction,
        careInstructions: PRODUCT_TEXT.care,
        deliveryInfo: PRODUCT_TEXT.delivery,
        displayOrder: i,
        isSample: true,
        publishedAt: p.status === "ACTIVE" ? new Date() : null,
        images: {
          create: await Promise.all(p.images.map(async (key, j) => ({ mediaId: await sampleMedia(key), sortOrder: j, isPrimary: j === 0 }))),
        },
        addOns: {
          create: p.addOns.map((a, j) => ({ addOnId: addOnIds[a.key]!, displayOrder: j, priceOverrideCents: a.price != null ? dollars(a.price) : null })),
        },
      },
    });
    for (const [j, g] of p.groups.entries()) {
      const values = valueIds[g.key]!;
      const overrides = Object.entries(values)
        .map(([name, id]) => ({
          optionValueId: id,
          enabled: !(g.disable ?? []).includes(name),
          priceModifierOverrideCents: g.priceOverrides?.[name] != null ? dollars(g.priceOverrides[name]!) : null,
          isDefault: g.defaults === name,
        }))
        .filter((o) => !o.enabled || o.priceModifierOverrideCents != null || o.isDefault);
      await prisma.productOptionGroup.create({
        data: { productId: product.id, optionGroupId: groupIds[g.key]!, displayOrder: j, valueOverrides: { create: overrides } },
      });
    }
  }
  log("products ok");

  // Portfolio
  for (const [i, p] of PORTFOLIO.entries()) {
    await prisma.portfolioProject.create({
      data: {
        name: p.name,
        slug: p.slug,
        summary: p.summary,
        description: p.description,
        furnitureType: p.furnitureType,
        wood: p.wood,
        finish: p.finish,
        dimensions: p.dimensions,
        status: "PUBLISHED",
        featured: p.featured,
        featuredOrder: i,
        displayOrder: i,
        isSample: true,
        publishedAt: new Date(),
        images: { create: await Promise.all(p.images.map(async (key, j) => ({ mediaId: await sampleMedia(key), sortOrder: j, isPrimary: j === 0 }))) },
      },
    });
  }
  log("portfolio ok");

  // FAQs
  const faqCats: Record<string, string> = {};
  for (const [i, c] of FAQ_CATEGORIES.entries()) {
    const cat = await prisma.faqCategory.upsert({ where: { slug: c.slug }, update: {}, create: { ...c, displayOrder: i } });
    faqCats[c.slug] = cat.id;
  }
  if ((await prisma.faq.count()) === 0) {
    for (const [i, f] of FAQS.entries()) {
      await prisma.faq.create({ data: { question: f.q, answer: f.a, categoryId: faqCats[f.category], displayOrder: i, showOnProductPages: f.product ?? false } });
    }
  }
  log("faqs ok");
}

/* ------------------------------------------------------------ main */

async function main() {
  await ensureSettings();
  const emptyCatalog = (await prisma.product.count()) === 0 && (await prisma.category.count()) === 0;
  const withSample = process.env.SEED_SAMPLE_CONTENT !== "false" && emptyCatalog;
  if (withSample) {
    log(`rendering sample imagery (${Object.keys(IMAGE_SPECS).length} images, storage: ${storage.name})…`);
    await prerenderImages(Object.keys(IMAGE_SPECS));
  }
  await ensurePages(withSample);
  await ensureAdmin();
  if (withSample) await seedSampleCatalog();
  else log("sample content skipped (catalog not empty or SEED_SAMPLE_CONTENT=false)");
  log("done");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
