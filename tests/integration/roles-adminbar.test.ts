import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest, jar } = await import("../support/next-request");
const { can } = await import("@/lib/auth/permissions");
const { requirePermission, requireAdmin } = await import("@/lib/auth/session");
const { guardAdminApi } = await import("@/lib/admin/api");
const productActions = await import("@/app/admin/(panel)/products/actions");
const securityActions = await import("@/app/admin/(panel)/security/actions");
const settingsActions = await import("@/app/admin/(panel)/settings/actions");
const { SiteAdminBar } = await import("@/components/admin-bar/SiteAdminBar");
const { resolveEditContext } = await import("@/lib/admin-bar/context");
const contextRoute = await import("@/app/api/admin/context/route");
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");

describe("permission matrix", () => {
  it("gives editors content work only, admins everything but owner functions", () => {
    for (const p of ["content", "navigation", "media", "own_account", "dashboard"] as const) expect(can("EDITOR", p)).toBe(true);
    for (const p of ["catalog", "promotions", "inbox", "settings", "admin_users", "audit"] as const) expect(can("EDITOR", p)).toBe(false);
    expect(can("ADMIN", "catalog")).toBe(true);
    expect(can("ADMIN", "admin_users")).toBe(false);
    expect(can("ADMIN", "audit")).toBe(false);
    expect(can("OWNER", "admin_users")).toBe(true);
    expect(can("SOMETHING", "dashboard")).toBe(false);
    expect(can(null, "dashboard")).toBe(false);
  });
});

describe.skipIf(!hasTestDb)("roles and the admin bar", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.siteSetting.create({ data: { id: "default" } });
    resetRequest();
  });

  it("enforces editor limits server-side (pages, actions, API routes)", async () => {
    const editor = await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    const { product } = await seedRidge();
    // Pages: allowed areas pass, others redirect away.
    await expect(requirePermission("content")).resolves.toMatchObject({ id: editor.id });
    await expect(requirePermission("catalog")).rejects.toThrow(/REDIRECT \/admin\?denied=1/);
    await expect(requireAdmin()).rejects.toThrow(/REDIRECT/);
    // Actions: product and owner/security actions refused, nothing changes.
    const fd = new FormData();
    fd.set("name", "Hacked");
    fd.set("slug", "hacked");
    expect(await productActions.saveProduct(product.id, fd)).toMatchObject({ ok: false, message: expect.stringMatching(/role/) });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).name).toBe("The Ridge Dining Table");
    expect(await securityActions.setAdminRole(editor.id, "OWNER")).toMatchObject({ ok: false });
    const add = new FormData();
    add.set("name", "Sneaky");
    add.set("email", "sneaky@example.com");
    add.set("role", "OWNER");
    add.set("password", "a-good-passphrase-1");
    expect((await securityActions.createAdminUser(add)).ok).toBe(false);
    expect(await prisma.adminUser.count()).toBe(1);
    expect((await settingsActions.saveSettings("features", new FormData())).ok).toBe(false);
    // API routes: media yes, product videos no.
    const get = (url: string) => new Request(url, { headers: { host: "localhost:3000" } });
    expect("admin" in (await guardAdminApi(get("http://localhost:3000/api/admin/media"), "media"))).toBe(true);
    const videos = await guardAdminApi(get("http://localhost:3000/api/admin/products/x/videos"), "catalog");
    expect("error" in videos && videos.error?.status).toBe(403);
  });

  it("admins can't manage roles; owners can, and role changes are audited", async () => {
    await createSignedInAdmin({ role: "ADMIN", email: "admin@example.com" });
    const target = await prisma.adminUser.create({ data: { email: "e@example.com", name: "Eddie", role: "ADMIN", twoFactorEnabled: true } });
    expect((await securityActions.setAdminRole(target.id, "EDITOR")).ok).toBe(false);
    jar.clear();
    await createSignedInAdmin({ role: "OWNER", email: "owner@example.com" });
    expect(await securityActions.setAdminRole(target.id, "EDITOR")).toMatchObject({ ok: true, message: expect.stringMatching(/editor/) });
    expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: target.id } })).role).toBe("EDITOR");
    expect(await prisma.activityLog.findFirst({ where: { type: "admin.role_changed" } })).toMatchObject({ message: expect.stringContaining("from admin to editor") });
  });

  it("renders the admin bar only for validated staff, with role-appropriate links", async () => {
    expect(await SiteAdminBar()).toBeNull(); // anonymous
    jar.set("wm_admin.session_token", "forged.value"); // a cookie alone is not enough
    expect(await SiteAdminBar()).toBeNull();
    jar.clear();

    await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    const bar = (await SiteAdminBar()) as { props: { name: string; links: Array<{ label: string }>; addNew: Array<{ label: string }> } };
    expect(bar.props.name).toBe("Editor");
    expect(bar.props.links.map((l) => l.label)).toEqual(["Dashboard", "Pages", "Media", "Navigation"]);
    expect(bar.props.addNew.map((l) => l.label)).toEqual(["Page", "Portfolio Project", "FAQ"]);

    jar.clear();
    await createSignedInAdmin({ role: "OWNER", email: "owner@example.com" });
    const ownerBar = (await SiteAdminBar()) as { props: { links: Array<{ label: string }>; addNew: Array<{ label: string }> } };
    expect(ownerBar.props.links.map((l) => l.label)).toEqual(["Dashboard", "Products", "Pages", "Media", "Navigation", "Promotions", "Quotes"]);
    expect(ownerBar.props.addNew.map((l) => l.label)).toEqual(["Product", "Page", "Portfolio Project", "FAQ", "Promotion"]);
  });

  it("links the admin bar's Edit button to the right record", async () => {
    const { product, category } = await seedRidge();
    const project = await prisma.portfolioProject.create({ data: { name: "Lakehouse Table", slug: "lakehouse-table" } });
    await prisma.page.create({ data: { slug: "financing", title: "Financing", isCustom: true, status: "DRAFT" } });
    const edit = async (path: string, role: "OWNER" | "EDITOR" = "OWNER") => (await resolveEditContext(path, role)).edit;
    expect(await edit("/")).toEqual({ label: "Edit Homepage", href: "/admin/homepage" });
    expect(await edit("/about")).toEqual({ label: "Edit Page", href: "/admin/pages/about" });
    expect(await edit("/faq")).toEqual({ label: "Edit FAQs", href: "/admin/faqs" });
    expect((await resolveEditContext("/faq", "OWNER")).secondary).toEqual({ label: "Edit Page", href: "/admin/pages/faq" });
    expect(await edit("/warranty")).toEqual({ label: "Edit Page", href: "/admin/pages/warranty" });
    expect(await edit("/furniture/ridge-dining-table")).toEqual({ label: "Edit Product", href: `/admin/products/${product.id}` });
    expect(await edit("/furniture/dining-tables")).toEqual({ label: "Edit Category", href: `/admin/categories/${category.id}` });
    expect(await edit("/our-work/lakehouse-table")).toEqual({ label: "Edit Project", href: `/admin/portfolio/${project.id}` });
    expect(await edit("/furniture/sale")).toEqual({ label: "Edit Sale Page", href: "/admin/pages/sale" });
    expect(await resolveEditContext("/financing", "OWNER")).toMatchObject({ edit: { href: "/admin/pages/financing" }, page: { status: "DRAFT", canPublish: true } });
    // Editors don't get catalog editors.
    expect(await edit("/furniture/ridge-dining-table", "EDITOR")).toBeNull();
    expect(await edit("/our-work/lakehouse-table", "EDITOR")).toMatchObject({ label: "Edit Project" });

    // The context API refuses anonymous callers.
    const res = await contextRoute.GET(new Request("http://localhost:3000/api/admin/context?path=/about"));
    expect(res?.status).toBe(401);
  });

  it("has no cart or checkout: sales are quote-based", async () => {
    const { existsSync } = await import("node:fs");
    for (const route of ["cart", "checkout"]) expect(existsSync(`src/app/(site)/${route}`)).toBe(false);
    expect("cart" in prisma).toBe(false);
  });
});
