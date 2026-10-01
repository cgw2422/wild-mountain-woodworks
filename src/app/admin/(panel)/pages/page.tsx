import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PAGE_DEFINITIONS, canChangeStatus, customPageDefinition, type PageDefinition } from "@/lib/cms/definitions";
import { AdminLinkButton, Badge, PageHeader } from "@/components/admin/ui";
import { PagesManager, type PageRow } from "@/components/admin/pages/PagesManager";
import { bulkSetPageStatus } from "./actions";

export const metadata: Metadata = { title: "Pages" };
export const dynamic = "force-dynamic";

export default async function PagesIndex() {
  await requirePermission("content");
  const rows = await prisma.page.findMany({
    select: {
      slug: true,
      title: true,
      isCustom: true,
      status: true,
      reviewRequired: true,
      updatedAt: true,
      publishedAt: true,
      updatedBy: { select: { name: true } },
    },
    orderBy: { title: "asc" },
  });
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const toRow = (def: PageDefinition): PageRow => {
    const r = bySlug.get(def.slug);
    return {
      slug: def.slug,
      title: r?.title ?? def.title,
      path: def.kind === "custom" ? `/${def.slug}` : def.path,
      description: def.kind !== "custom" ? def.description : null,
      status: r?.status ?? "PUBLISHED",
      statusEditable: canChangeStatus(def),
      template: Boolean(def.template),
      templateNote: def.template ? `Shared on every ${def.slug === "product" ? "product" : "project"} page` : null,
      editHref: def.slug === "home" ? "/admin/homepage" : `/admin/pages/${def.slug}`,
      reviewRequired: r?.reviewRequired ?? false,
      unpublishWarning: def.unpublishWarning ?? null,
      updatedAt: r?.updatedAt.toISOString() ?? null,
      publishedAt: r?.publishedAt?.toISOString() ?? null,
      updatedBy: r?.updatedBy?.name ?? null,
    };
  };
  const all: PageRow[] = [
    ...rows.filter((r) => r.isCustom).map((r) => toRow(customPageDefinition(r))),
    ...PAGE_DEFINITIONS.map(toRow),
  ];
  const kindOf = new Map([...PAGE_DEFINITIONS.map((d) => [d.slug, d.kind] as const), ...rows.filter((r) => r.isCustom).map((r) => [r.slug, "custom"] as const)]);
  const live = all.filter((r) => r.status !== "ARCHIVED" || r.template);
  const needsReview = rows.filter((r) => r.reviewRequired).length;

  const groups = [
    {
      title: "Your pages",
      description: "Pages created here. New pages start as drafts; publish when ready, then add them to a menu in Navigation.",
      rows: live.filter((r) => kindOf.get(r.slug) === "custom"),
      empty: "No pages yet. Use “Create page” to add one — for example Financing, Trade Program or Our Story.",
    },
    {
      title: "Site pages",
      description: "Structured pages built from sections. Every page with its own address can be published, drafted or archived; the homepage is always live.",
      rows: live.filter((r) => kindOf.get(r.slug) === "system"),
    },
    {
      title: "Customer care & policy pages",
      description: "Long-form pages written in Markdown. Draft policy language is flagged for owner/legal review.",
      rows: live.filter((r) => kindOf.get(r.slug) === "policy"),
    },
    { title: "Archived", description: "Not on the public site. Select and publish (or open a page) to restore it.", rows: all.filter((r) => r.status === "ARCHIVED" && !r.template) },
  ];

  return (
    <>
      <PageHeader
        title="Pages"
        description="Create pages, edit copy and images, and publish, draft or archive any page. Draft and archived pages are hidden from visitors, menus, breadcrumbs and the sitemap — and come back when republished."
        actions={
          <>
            {needsReview ? <Badge tone="amber">{needsReview} page{needsReview === 1 ? "" : "s"} need review</Badge> : null}
            <AdminLinkButton href="/admin/pages/new" variant="primary">
              Create page
            </AdminLinkButton>
          </>
        }
      />
      <PagesManager groups={groups} bulk={bulkSetPageStatus} />
    </>
  );
}
