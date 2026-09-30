import "server-only";
import { prisma } from "@/lib/db";
import { can, type Role } from "@/lib/auth/permissions";
import { getPageDefinition } from "@/lib/cms/definitions";

export interface EditLink {
  label: string;
  href: string;
}

export interface EditContext {
  /** Main "Edit …" link for the record behind this URL (only if the role may edit it). */
  edit: EditLink | null;
  /** A second editor where one page has two (e.g. FAQ questions + FAQ page header). */
  secondary: EditLink | null;
  /** CMS page behind this URL, for the draft indicator / Publish. */
  page: { slug: string; status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; canPublish: boolean } | null;
}

const EMPTY: EditContext = { edit: null, secondary: null, page: null };

/**
 * Work out which admin record a public URL shows, so the admin bar can link
 * straight to its editor. Links the role can't use are left out (the editors
 * enforce the same permissions server-side regardless).
 */
export async function resolveEditContext(rawPath: string, role: Role): Promise<EditContext> {
  const path = rawPath.split("?")[0]!.split("#")[0]!.replace(/\/+$/, "") || "/";
  const content = can(role, "content");
  const catalog = can(role, "catalog");

  const pageCtx = async (slug: string, label = "Edit Page"): Promise<EditContext> => {
    const row = await prisma.page.findUnique({ where: { slug }, select: { status: true } });
    const def = getPageDefinition(slug);
    return {
      ...EMPTY,
      edit: content ? { label, href: slug === "home" ? "/admin/homepage" : `/admin/pages/${slug}` } : null,
      page: { slug, status: row?.status ?? "PUBLISHED", canPublish: content && Boolean(def ? def.statusControl : true) },
    };
  };

  if (path === "/") return pageCtx("home", "Edit Homepage");
  if (path === "/furniture") return pageCtx("furniture");
  if (path === "/furniture/sale") return pageCtx("sale", "Edit Sale Page");
  if (path === "/our-work") return pageCtx("our-work");
  if (path === "/faq") {
    const ctx = await pageCtx("faq", "Edit FAQs");
    return { ...ctx, edit: content ? { label: "Edit FAQs", href: "/admin/faqs" } : null, secondary: content ? { label: "Edit Page", href: "/admin/pages/faq" } : null };
  }

  const furniture = /^\/furniture\/([a-z0-9-]+)$/.exec(path);
  if (furniture) {
    const slug = furniture[1]!;
    const category = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
    if (category) return { ...EMPTY, edit: catalog ? { label: "Edit Category", href: `/admin/categories/${category.id}` } : null };
    const product = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
    return product ? { ...EMPTY, edit: catalog ? { label: "Edit Product", href: `/admin/products/${product.id}` } : null } : EMPTY;
  }

  const project = /^\/our-work\/([a-z0-9-]+)$/.exec(path);
  if (project) {
    const p = await prisma.portfolioProject.findUnique({ where: { slug: project[1]! }, select: { id: true } });
    return p ? { ...EMPTY, edit: content ? { label: "Edit Project", href: `/admin/portfolio/${p.id}` } : null } : EMPTY;
  }

  const top = /^\/([a-z0-9-]+)$/.exec(path);
  if (top) {
    const slug = top[1]!;
    const def = getPageDefinition(slug);
    if (def || (await prisma.page.findUnique({ where: { slug }, select: { id: true } }))) return pageCtx(def?.slug ?? slug);
  }
  return EMPTY;
}
