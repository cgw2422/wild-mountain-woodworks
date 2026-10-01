import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest, request, jar } = await import("../support/next-request");
const { getVisiblePage, isPathPublic, unpublishedPagePaths } = await import("@/lib/cms/pages");
const { PAGE_DEFINITIONS, canChangeStatus } = await import("@/lib/cms/definitions");
const { visibleCrumbs } = await import("@/components/site/Breadcrumbs");
const { getPageContent } = await import("@/lib/cms/queries");
const { IfPublic } = await import("@/components/site/IfPublic");
const { getMenu } = await import("@/lib/navigation/menus");
const pageActions = await import("@/app/admin/(panel)/pages/actions");
const navActions = await import("@/app/admin/(panel)/navigation/actions");
const { applyRequiredDefaults } = await import("@/lib/seed/defaults");
const sitemap = (await import("@/app/sitemap")).default;
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");

const quiet = () => {};

async function createPublishedPage(slug = "financing", title = "Financing") {
  return prisma.page.create({ data: { slug, title, isCustom: true, status: "PUBLISHED", publishedAt: new Date(), body: "Terms." } });
}

async function mainMenu() {
  return prisma.menu.upsert({ where: { key: "MAIN" }, update: {}, create: { key: "MAIN", name: "Main navigation" } });
}

const labels = (items: Array<{ label: string; children: Array<{ label: string }> }>) => items.map((i) => (i.children.length ? `${i.label}>${i.children.map((c) => c.label).join(",")}` : i.label));

describe.skipIf(!hasTestDb)("CMS pages, preview and navigation", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.siteSetting.create({ data: { id: "default" } });
    resetRequest();
  });

  it("new pages default to DRAFT and aren't public; publishing makes them public", async () => {
    await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    const fd = new FormData();
    fd.set("title", "Trade Program");
    const res = await pageActions.createPage(fd);
    expect(res).toMatchObject({ ok: true, id: "trade-program" });
    expect(await prisma.page.findUnique({ where: { slug: "trade-program" } })).toMatchObject({ status: "DRAFT", isCustom: true, publishedAt: null });
    expect(await prisma.activityLog.count({ where: { type: "page.created" } })).toBe(1);

    jar.clear(); // anonymous visitor
    expect(await getVisiblePage("trade-program")).toBeNull();

    await createSignedInAdmin({ role: "EDITOR", email: "editor2@example.com" });
    expect((await pageActions.setPageStatus("trade-program", "PUBLISHED")).ok).toBe(true);
    jar.clear();
    expect(await getVisiblePage("trade-program")).toMatchObject({ preview: false, page: { title: "Trade Program" } });
    expect((await prisma.page.findUnique({ where: { slug: "trade-program" } }))!.publishedAt).toBeInstanceOf(Date);
  });

  it("rejects reserved or taken addresses", async () => {
    await createSignedInAdmin();
    await createPublishedPage();
    for (const slug of ["about", "cart", "admin", "furniture", "financing", "Bad Slug"]) {
      const fd = new FormData();
      fd.set("title", "X");
      fd.set("slug", slug);
      expect((await pageActions.createPage(fd)).ok, slug).toBe(false);
    }
  });

  it("drafting a published page hides it everywhere at once; republishing restores it", async () => {
    await createSignedInAdmin();
    const page = await createPublishedPage();
    const menu = await mainMenu();
    await prisma.menuItem.create({ data: { menuId: menu.id, type: "INTERNAL_PAGE", pageId: page.id } });
    await prisma.menu.create({ data: { key: "COMPANY", name: "Company", items: { create: { type: "INTERNAL_PAGE", pageId: page.id, label: "Financing Options" } } } });

    const urls = async () => (await sitemap()).map((e) => e.url);
    expect(await getVisiblePage("financing")).not.toBeNull();
    expect(labels((await getMenu("MAIN")).items)).toEqual(["Financing"]);
    expect(labels((await getMenu("COMPANY")).items)).toEqual(["Financing Options"]);
    expect((await urls()).some((u) => u.endsWith("/financing"))).toBe(true);

    expect(await pageActions.setPageStatus("financing", "DRAFT")).toMatchObject({ ok: true });
    jar.clear();
    expect(await getVisiblePage("financing")).toBeNull(); // public 404
    expect((await getMenu("MAIN")).items).toEqual([]);
    expect((await getMenu("COMPANY")).items).toEqual([]);
    expect((await urls()).some((u) => u.endsWith("/financing"))).toBe(false);
    // The page, its content and the menu relationships are kept.
    expect(await prisma.page.findUnique({ where: { slug: "financing" } })).toMatchObject({ body: "Terms.", status: "DRAFT" });
    expect(await prisma.menuItem.count({ where: { pageId: page.id } })).toBe(2);
    expect(await prisma.activityLog.findFirst({ where: { type: "page.drafted" } })).toMatchObject({ message: expect.stringContaining("published → draft") });

    await createSignedInAdmin({ email: "o2@example.com" });
    await pageActions.setPageStatus("financing", "PUBLISHED");
    jar.clear();
    expect(await getVisiblePage("financing")).not.toBeNull();
    expect(labels((await getMenu("MAIN")).items)).toEqual(["Financing"]);
    expect((await urls()).some((u) => u.endsWith("/financing"))).toBe(true);
  });

  it("EVERY standalone page can be drafted, hidden everywhere, previewed and republished — no allow-list", async () => {
    await prisma.$transaction((tx) => applyRequiredDefaults(tx, quiet, {}));
    await seedRidge();
    await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    const pages = PAGE_DEFINITIONS.filter((d) => canChangeStatus(d));
    // Every core/policy page with its own address is covered (and future ones automatically).
    expect(pages.map((d) => d.slug)).toEqual(
      expect.arrayContaining(["about", "faq", "contact", "custom-furniture", "our-work", "furniture", "sale", "request-quote", "shipping-delivery", "returns-cancellations", "warranty", "wood-characteristics", "furniture-care", "privacy", "terms"]),
    );
    await prisma.menu.deleteMany(); // replace the starter menus with one item per page
    const menu = await mainMenu();
    for (const d of pages) {
      const row = await prisma.page.findUniqueOrThrow({ where: { slug: d.slug } });
      await prisma.menuItem.create({ data: { menuId: menu.id, type: "INTERNAL_PAGE", pageId: row.id, label: d.slug } });
    }
    const publicMenu = async () => (await getMenu("MAIN")).items.map((i) => i.label);
    expect(await publicMenu()).toHaveLength(pages.length);

    for (const status of ["DRAFT", "ARCHIVED"] as const) {
      const res = await pageActions.bulkSetPageStatus(
        pages.map((d) => d.slug),
        status,
      );
      expect(res).toMatchObject({ ok: true, message: expect.stringContaining(`${pages.length} pages`) });
      jar.clear(); // anonymous
      for (const d of pages) expect(await getVisiblePage(d.slug), `${d.slug} ${status}`).toBeNull();
      expect(await publicMenu()).toEqual([]);
      const urls = (await sitemap()).map((e) => new URL(e.url).pathname);
      for (const d of pages) expect(urls, d.slug).not.toContain(d.path);
      expect(urls).toContain("/"); // the homepage stays
      // Staff can still preview every one of them.
      await createSignedInAdmin({ role: "EDITOR", email: `e-${status}@example.com` });
      request.draftMode = true;
      for (const d of pages) expect(await getVisiblePage(d.slug), d.slug).toMatchObject({ preview: true });
      request.draftMode = false;
    }
    // Content and menu relationships survive; republishing restores everything.
    expect(await prisma.menuItem.count({ where: { menuId: menu.id } })).toBe(pages.length);
    await pageActions.bulkSetPageStatus(
      pages.map((d) => d.slug),
      "PUBLISHED",
    );
    jar.clear();
    for (const d of pages) expect(await getVisiblePage(d.slug), d.slug).not.toBeNull();
    expect(await publicMenu()).toHaveLength(pages.length);
    expect(await prisma.activityLog.count({ where: { type: "page.drafted" } })).toBe(pages.length);
    expect(await prisma.activityLog.count({ where: { type: "page.archived" } })).toBe(pages.length);
  });

  it("the homepage and shared content blocks can't change status; bulk actions skip them", async () => {
    await createSignedInAdmin();
    expect(await pageActions.setPageStatus("home", "DRAFT")).toMatchObject({ ok: false, message: expect.stringMatching(/homepage/) });
    expect(await pageActions.setPageStatus("product", "DRAFT")).toMatchObject({ ok: false, message: expect.stringMatching(/shared content block/) });
    const res = await pageActions.bulkSetPageStatus(["home", "about", "product"], "DRAFT");
    expect(res).toMatchObject({ ok: true, message: expect.stringMatching(/1 page moved to draft\. Skipped: Homepage, Product pages/) });
    jar.clear();
    expect(await getVisiblePage("home")).not.toBeNull();
    expect(await getVisiblePage("about")).toBeNull();
  });

  it("menus suppress custom links to unpublished pages; breadcrumbs and header CTA skip them too", async () => {
    await prisma.$transaction((tx) => applyRequiredDefaults(tx, quiet, {}));
    await createSignedInAdmin();
    await prisma.menu.deleteMany();
    const menu = await mainMenu();
    await prisma.menuItem.createMany({
      data: [
        { menuId: menu.id, type: "CUSTOM_INTERNAL_LINK", label: "About us", url: "/about/", displayOrder: 0 },
        { menuId: menu.id, type: "CUSTOM_INTERNAL_LINK", label: "Sale", url: "/furniture/sale?ref=nav", displayOrder: 1 },
        { menuId: menu.id, type: "CUSTOM_INTERNAL_LINK", label: "Shop", url: "/furniture", displayOrder: 2 },
      ],
    });
    expect((await getMenu("MAIN")).items.map((i) => i.label)).toEqual(["About us", "Sale", "Shop"]);
    await pageActions.bulkSetPageStatus(["about", "sale", "request-quote"], "DRAFT");
    jar.clear();
    expect(await unpublishedPagePaths()).toEqual(new Set(["/about", "/furniture/sale", "/request-quote"]));
    expect((await getMenu("MAIN")).items.map((i) => i.label)).toEqual(["Shop"]);
    expect(await isPathPublic("/furniture")).toBe(true);
    expect(await isPathPublic("/About?x=1")).toBe(false);
    // Breadcrumbs drop links to unpublished pages (never the current page).
    await createSignedInAdmin({ email: "o3@example.com" });
    await pageActions.setPageStatus("furniture", "DRAFT");
    jar.clear();
    expect(await visibleCrumbs([{ label: "Furniture", href: "/furniture" }, { label: "FAQ", href: "/faq" }, { label: "Ridge Table" }])).toEqual([{ label: "FAQ", href: "/faq" }, { label: "Ridge Table" }]);
    // Editor-authored section buttons and item links to drafted pages are dropped too.
    const home = await prisma.page.findUniqueOrThrow({ where: { slug: "home" } });
    await prisma.pageSection.upsert({
      where: { pageId_key: { pageId: home.id, key: "about" } },
      update: { primaryCtaLabel: "Our Story", primaryCtaHref: "/about", secondaryCtaLabel: "FAQ", secondaryCtaHref: "/faq" },
      create: { pageId: home.id, key: "about", primaryCtaLabel: "Our Story", primaryCtaHref: "/about", secondaryCtaLabel: "FAQ", secondaryCtaHref: "/faq" },
    });
    const section = (await getPageContent("home")).section("about");
    expect(section.primaryCta).toBeNull();
    expect(section.secondaryCta).toEqual({ label: "FAQ", href: "/faq" });
    // IfPublic hides built-in links to drafted pages.
    expect(await IfPublic({ path: "/furniture", children: "link" })).toMatchObject({ props: { children: null } });
    expect(await IfPublic({ path: "/faq", children: "link" })).toMatchObject({ props: { children: "link" } });
  });

  it("authorized staff can preview a draft; anonymous visitors with the preview cookie can't", async () => {
    await prisma.page.create({ data: { slug: "draft-page", title: "Draft Page", isCustom: true, status: "DRAFT" } });
    request.draftMode = true; // a copied/forged Draft Mode cookie alone grants nothing
    expect(await getVisiblePage("draft-page")).toBeNull();

    await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    request.draftMode = false;
    expect(await getVisiblePage("draft-page")).toBeNull(); // not in preview
    request.draftMode = true;
    expect(await getVisiblePage("draft-page")).toMatchObject({ preview: true });
  });

  it("duplicates a page as a new draft with its content", async () => {
    await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    const page = await createPublishedPage();
    await prisma.pageSection.create({ data: { pageId: page.id, key: "hero", heading: "Easy financing" } });
    const res = await pageActions.duplicatePage("financing");
    expect(res).toMatchObject({ ok: true, id: "financing-copy" });
    const copy = await prisma.page.findUnique({ where: { slug: "financing-copy" }, include: { sections: true } });
    expect(copy).toMatchObject({ status: "DRAFT", body: "Terms.", title: "Copy of Financing" });
    expect(copy!.sections[0]).toMatchObject({ key: "hero", heading: "Easy financing" });
  });

  it("menu items: custom and external links, disabled items, nesting, headings and commerce-only", async () => {
    await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    const add = async (fields: Record<string, string>) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries({ enabled: "on", ...fields })) fd.set(k, v);
      return navActions.createMenuItem("MAIN", fd);
    };
    expect(await add({ type: "CUSTOM_INTERNAL_LINK", label: "Sale", url: "/furniture/sale" })).toMatchObject({ ok: true });
    expect(await add({ type: "EXTERNAL_LINK", label: "Instagram", url: "https://instagram.com/wildmountain", openInNewTab: "on" })).toMatchObject({ ok: true });
    expect(await add({ type: "LABEL", label: "Shop" })).toMatchObject({ ok: true });
    expect(await add({ type: "CART" })).toMatchObject({ ok: false }); // no cart: sales are quote-based
    // Unsafe links are rejected server-side.
    expect(await add({ type: "EXTERNAL_LINK", label: "Bad", url: "javascript:alert(1)" })).toMatchObject({ ok: false, fieldErrors: { url: expect.any(String) } });
    expect(await add({ type: "CUSTOM_INTERNAL_LINK", label: "Bad", url: "//evil.example" })).toMatchObject({ ok: false });

    let menu = await getMenu("MAIN");
    // "Shop" heading has no children yet → hidden.
    expect(labels(menu.items)).toEqual(["Sale", "Instagram"]);
    const instagram = menu.items[1]!;
    expect(instagram).toMatchObject({ href: "https://instagram.com/wildmountain", external: true, newTab: true });

    const shop = await prisma.menuItem.findFirstOrThrow({ where: { label: "Shop" } });
    const { category } = await seedRidge();
    expect(await add({ type: "PRODUCT_CATEGORY", categoryId: category.id, parentId: shop.id })).toMatchObject({ ok: true });
    menu = await getMenu("MAIN");
    expect(labels(menu.items)).toEqual(["Sale", "Instagram", "Shop>Dining Tables"]);
    expect(menu.items[2]!).toMatchObject({ href: null });
    expect(menu.items[2]!.children[0]).toMatchObject({ href: "/furniture/dining-tables" });

    // Disable an item → hidden (kept in the admin).
    const sale = await prisma.menuItem.findFirstOrThrow({ where: { label: "Sale" } });
    await navActions.setMenuItemEnabled(sale.id, false);
    expect(labels((await getMenu("MAIN")).items)).toEqual(["Instagram", "Shop>Dining Tables"]);

    // Hidden category → its item disappears, and the empty heading with it.
    await prisma.category.update({ where: { id: category.id }, data: { visible: false } });
    expect(labels((await getMenu("MAIN")).items)).toEqual(["Instagram"]);

    // Reorder + audit.
    const top = await prisma.menuItem.findMany({ where: { parentId: null }, orderBy: { displayOrder: "asc" } });
    expect((await navActions.reorderMenuItems("MAIN", null, [...top].reverse().map((t) => t.id))).ok).toBe(true);
    expect(await prisma.activityLog.count({ where: { type: { in: ["menu.item_created", "menu.item_updated", "menu.reordered"] } } })).toBeGreaterThanOrEqual(6);
  });

  it("seeds starter menus matching the old header/footer, once", async () => {
    await prisma.$transaction((tx) => applyRequiredDefaults(tx, quiet, {}));
    expect(labels((await getMenu("MAIN")).items)).toEqual(["Furniture", "Our Work", "Custom Furniture", "About", "FAQ", "Contact"]);
    expect(labels((await getMenu("LEGAL")).items)).toEqual(["Privacy", "Terms"]);
    await prisma.menuItem.deleteMany({ where: { menu: { key: "LEGAL" } } });
    await prisma.$transaction((tx) => applyRequiredDefaults(tx, quiet, {}));
    expect((await getMenu("LEGAL")).items).toEqual([]); // never re-created
  });
});
