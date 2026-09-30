import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {requirePermission} from "@/lib/auth/session";
import { getPageDefinition } from "@/lib/cms/definitions";
import { ActionForm, SubmitButton, Toggle } from "@/components/admin/forms";
import { PageSettingsForm } from "@/components/admin/content/PageSettingsForm";
import { OrderedPicker } from "@/components/admin/content/OrderedPicker";
import { SectionEditor } from "@/components/admin/content/SectionEditor";
import type { PickerOption } from "@/components/admin/content/types";
import { AdminLinkButton, Badge, Card, PageHeader, formatDate } from "@/components/admin/ui";
import { savePageSettings, saveSection } from "../pages/actions";
import { linkSuggestions, loadPageForEditor } from "../pages/data";
import { saveFeaturedProducts, saveFeaturedProjects, saveHomepageCategories } from "./actions";

export const metadata: Metadata = { title: "Homepage" };

const thumbSelect = { url: true, alt: true, focalX: true, focalY: true } as const;
const primaryImage = {
  orderBy: [{ isPrimary: "desc" as const }, { sortOrder: "asc" as const }],
  take: 1,
  select: { media: { select: thumbSelect } },
};

export default async function HomepageEditor() {
  await requirePermission("content");
  const def = getPageDefinition("home");
  if (!def) notFound();

  const [{ page, sections }, products, projects, categories] = await Promise.all([
    loadPageForEditor(def),
    prisma.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ featured: "desc" }, { featuredOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, featured: true, category: { select: { name: true } }, images: primaryImage },
    }),
    prisma.portfolioProject.findMany({
      where: { status: "PUBLISHED" },
      orderBy: [{ featured: "desc" }, { featuredOrder: "asc" }, { displayOrder: "asc" }],
      select: { id: true, name: true, featured: true, furnitureType: true, wood: true, images: primaryImage },
    }),
    prisma.category.findMany({
      where: { archivedAt: null },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, visible: true, showOnHomepage: true, displayOrder: true, image: { select: thumbSelect } },
    }),
  ]);

  const productOptions: PickerOption[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    detail: p.category?.name ?? "Uncategorized",
    image: p.images[0]?.media ?? null,
    href: `/admin/products/${p.id}`,
  }));
  const projectOptions: PickerOption[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    detail: [p.furnitureType, p.wood].filter(Boolean).join(" · ") || null,
    image: p.images[0]?.media ?? null,
    href: `/admin/portfolio/${p.id}`,
  }));
  const links = await linkSuggestions();
  const homeCategories = categories.filter((c) => c.showOnHomepage && c.visible);

  const panels: Record<string, React.ReactNode> = {
    categories: (
      <Card
        id="panel-categories"
        title="Homepage categories"
        description="Choose which categories appear as tiles. They're shown in the same order as the catalog; change order, images and names in Categories."
        actions={<AdminLinkButton href="/admin/categories">Manage categories</AdminLinkButton>}
      >
        {categories.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No categories yet. <Link href="/admin/categories" className="underline">Create a category</Link> to show it here.
          </p>
        ) : (
          <ActionForm action={saveHomepageCategories} successMessage={null} className="space-y-4">
            <ul className="divide-y divide-neutral-100 rounded border border-neutral-200">
              {categories.map((c, i) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className="w-6 text-center text-xs tabular-nums text-neutral-500" title="Catalog order">
                    {i + 1}
                  </span>
                  <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded bg-neutral-100">
                    {c.image ? (
                      <Image src={c.image.url} alt="" fill sizes="40px" className="object-cover" style={{ objectPosition: `${c.image.focalX}% ${c.image.focalY}%` }} />
                    ) : null}
                  </span>
                  <Toggle name={`show-${c.id}`} label={c.name} defaultChecked={c.showOnHomepage} className="min-w-0 flex-1" />
                  <span className="flex flex-wrap items-center gap-2">
                    {!c.visible ? <Badge tone="amber">Hidden in catalog — won&apos;t show</Badge> : null}
                    {!c.image ? <Badge tone="amber">No image</Badge> : null}
                    <Link href={`/admin/categories/${c.id}`} className="inline-block px-1 py-1 text-xs text-neutral-600 underline hover:text-neutral-900">
                      Edit<span className="sr-only"> {c.name}</span>
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-neutral-500">{homeCategories.length} categor{homeCategories.length === 1 ? "y is" : "ies are"} currently on the homepage.</p>
              <SubmitButton>Save homepage categories</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Card>
    ),
    featured: (
      <Card id="panel-featured" title="Featured furniture" description="Active products shown in the Featured Furniture section, in this order. Drag to reorder.">
        <OrderedPicker
          options={productOptions}
          selectedIds={products.filter((p) => p.featured).map((p) => p.id)}
          onSave={saveFeaturedProducts}
          noun={{ singular: "product", plural: "products" }}
          emptyText="No featured products. Add some from the list — only active (published) products can be featured."
          max={12}
        />
      </Card>
    ),
    work: (
      <Card id="panel-work" title="Featured projects" description="Published portfolio projects shown in the Our Work preview, in this order.">
        <OrderedPicker
          options={projectOptions}
          selectedIds={projects.filter((p) => p.featured).map((p) => p.id)}
          onSave={saveFeaturedProjects}
          noun={{ singular: "project", plural: "projects" }}
          emptyText="No featured projects. Add published projects from the list."
          max={12}
        />
      </Card>
    ),
  };

  return (
    <>
      <PageHeader
        title="Homepage"
        description={
          <>
            Edit each homepage section: copy, photographs, buttons and visibility. Changes are live as soon as you save.
            {page ? ` Last updated ${formatDate(page.updatedAt, true)}.` : ""}
          </>
        }
        actions={
          <>
            <AdminLinkButton href="/admin/pages">All pages</AdminLinkButton>
            <AdminLinkButton href="/" target="_blank" variant="primary">
              View homepage ↗
            </AdminLinkButton>
          </>
        }
      />

      <nav aria-label="Homepage sections" className="mb-6 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        <span className="text-neutral-500">Jump to:</span>
        {def.sections.map((s) => (
          <a key={s.key} href={`#section-${s.key}`} className="inline-block py-1 text-neutral-700 underline hover:text-neutral-900">
            {s.label}
          </a>
        ))}
        <a href="#page-settings" className="text-neutral-700 underline hover:text-neutral-900">
          SEO &amp; sharing
        </a>
      </nav>

      <div className="space-y-6">
        {def.sections.map((sd, i) => (
          <div key={sd.key} className="space-y-3">
            <SectionEditor
              id={`section-${sd.key}`}
              definition={sd}
              value={sections[i]!}
              action={saveSection.bind(null, "home", sd.key)}
              linkSuggestions={links}
            />
            {panels[sd.key] ? <div className="border-l-4 border-neutral-200 pl-3 sm:pl-5">{panels[sd.key]}</div> : null}
          </div>
        ))}

        <Card id="page-settings" title="Homepage SEO & sharing" description="How the homepage appears in search results and when shared on social media.">
          <PageSettingsForm
            action={savePageSettings.bind(null, "home")}
            title={page?.title ?? def.title}
            defaultTitle={def.title}
            navLabel={page?.navLabel ?? null}
            slug={null}
            seoTitle={page?.seoTitle ?? null}
            seoDescription={page?.seoDescription ?? null}
            ogImage={page?.ogImage ?? null}
          />
        </Card>
      </div>
    </>
  );
}
