import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { ActionButton, ActionForm, ConfirmAction, SubmitButton, TextArea, TextInput, Toggle } from "@/components/admin/forms";
import { MarkdownEditor } from "@/components/admin/content/MarkdownEditor";
import { SeoFields } from "@/components/admin/content/SeoFields";
import { AdminLinkButton, Badge, Card, DescriptionList, PageHeader, StatusBadge, formatDate } from "@/components/admin/ui";
import { deleteProject, saveGallery, setProjectStatus, updateProject } from "../actions";
import { GalleryManager, type GalleryImage } from "./GalleryManager";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const p = await prisma.portfolioProject.findUnique({ where: { id }, select: { name: true } });
  return { title: p?.name ?? "Project" };
}

export default async function EditProject({ params }: Props) {
  await requireAdmin();
  const { id } = await params;
  const project = await prisma.portfolioProject.findUnique({
    where: { id },
    include: {
      images: {
        orderBy: { sortOrder: "asc" },
        include: { media: { select: { id: true, url: true, alt: true, width: true, height: true, focalX: true, focalY: true } } },
      },
    },
  });
  if (!project) notFound();

  const gallery: GalleryImage[] = project.images.map((i) => ({
    id: i.media.id,
    url: i.media.url,
    mediaAlt: i.media.alt,
    alt: i.alt,
    isPrimary: i.isPrimary,
    width: i.media.width,
    height: i.media.height,
    focalX: i.media.focalX,
    focalY: i.media.focalY,
  }));
  const status = project.status;
  const canPublish = project.images.length > 0 && project.summary.trim().length > 0;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Portfolio", href: "/admin/portfolio" }, { label: project.name }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {project.name} <StatusBadge status={status} />
            {project.featured ? <Badge tone="blue">Featured</Badge> : null}
            {project.isSample ? <Badge tone="violet">Sample</Badge> : null}
          </span>
        }
        actions={
          <>
            <AdminLinkButton href={`/admin/preview/portfolio/${project.id}`} target="_blank">
              Preview ↗
            </AdminLinkButton>
            {status === "PUBLISHED" ? (
              <AdminLinkButton href={`/our-work/${project.slug}`} target="_blank">
                View live ↗
              </AdminLinkButton>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <Card title="Photos" description="The primary photo appears on the Our Work grid and homepage. Drag to set the gallery order.">
            <GalleryManager initial={gallery} onSave={saveGallery.bind(null, project.id)} />
          </Card>

          <ActionForm action={updateProject.bind(null, project.id)} className="space-y-6">
            <Card title="Project details">
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <TextInput name="name" label="Project name" required defaultValue={project.name} maxLength={160} />
                  <TextInput
                    name="slug"
                    label="URL slug"
                    required
                    defaultValue={project.slug}
                    maxLength={80}
                    help={
                      <>
                        /our-work/<strong>{project.slug}</strong> — changing it changes the page&apos;s address, so links shared earlier will stop working.
                      </>
                    }
                  />
                </div>
                <TextArea name="summary" label="Summary" rows={2} defaultValue={project.summary} maxLength={500} help="One or two sentences shown on the Our Work grid. Required to publish." />
                <MarkdownEditor name="description" label="Story / description" defaultValue={project.description} rows={12} maxLength={20000} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <TextInput name="furnitureType" label="Furniture type" defaultValue={project.furnitureType ?? ""} maxLength={120} placeholder="Dining table" />
                  <TextInput name="wood" label="Wood" defaultValue={project.wood ?? ""} maxLength={120} placeholder="Black walnut" />
                  <TextInput name="finish" label="Finish" defaultValue={project.finish ?? ""} maxLength={120} placeholder="Hardwax oil" />
                  <TextInput name="dimensions" label="Dimensions" defaultValue={project.dimensions ?? ""} maxLength={300} placeholder={`84" L × 40" W × 30" H`} />
                  <TextInput name="location" label="Location (optional)" defaultValue={project.location ?? ""} maxLength={120} placeholder="Columbus, OH" help="Only if the client is happy to share it." />
                </div>
              </div>
            </Card>

            <Card title="Display">
              <div className="space-y-4">
                <Toggle name="featured" label="Feature on the homepage" description="Shown in the Our Work preview when published. You can also reorder featured projects on the Homepage editor." defaultChecked={project.featured} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextInput name="featuredOrder" label="Homepage order" type="number" min={0} max={9999} defaultValue={project.featuredOrder} help="Lower numbers appear first." />
                  <TextInput name="displayOrder" label="Our Work order" type="number" min={0} max={99999} defaultValue={project.displayOrder} help="Or drag projects on the Portfolio list." />
                </div>
              </div>
            </Card>

            <Card title="Search & sharing">
              <SeoFields title={project.seoTitle} description={project.seoDescription} titlePlaceholder={project.name} descriptionPlaceholder={project.summary || undefined} />
            </Card>

            <div className="flex justify-end">
              <SubmitButton>Save project</SubmitButton>
            </div>
          </ActionForm>
        </div>

        <aside className="min-w-0 space-y-6">
          <Card title="Status">
            <div className="space-y-4">
              <p className="text-sm text-neutral-600">
                {status === "PUBLISHED"
                  ? "Published — visible on the Our Work page."
                  : status === "DRAFT"
                    ? "Draft — only visible to admins in preview."
                    : "Archived — hidden from the site and kept for your records."}
              </p>
              {status === "DRAFT" && !canPublish ? (
                <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  To publish, add {project.images.length === 0 ? "at least one photo" : ""}
                  {project.images.length === 0 && !project.summary.trim() ? " and " : ""}
                  {!project.summary.trim() ? "a summary (then save)" : ""}.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {status === "DRAFT" ? (
                  <ActionButton action={setProjectStatus.bind(null, project.id, "PUBLISHED")} variant="primary" pendingLabel="Publishing…">
                    Publish
                  </ActionButton>
                ) : null}
                {status === "PUBLISHED" ? (
                  <ConfirmAction
                    action={setProjectStatus.bind(null, project.id, "DRAFT")}
                    label="Unpublish"
                    title="Unpublish this project?"
                    body="It will be hidden from Our Work and the homepage until you publish it again."
                    confirmLabel="Unpublish"
                    confirmVariant="primary"
                    successMessage="Unpublished."
                  />
                ) : null}
                {status === "ARCHIVED" ? (
                  <ActionButton action={setProjectStatus.bind(null, project.id, "DRAFT")} pendingLabel="Restoring…">
                    Restore as draft
                  </ActionButton>
                ) : (
                  <ConfirmAction
                    action={setProjectStatus.bind(null, project.id, "ARCHIVED")}
                    label="Archive"
                    title="Archive this project?"
                    body="It will be hidden from the site and removed from the homepage preview. You can restore it at any time."
                    confirmLabel="Archive"
                    confirmVariant="primary"
                    successMessage="Archived."
                  />
                )}
              </div>
              <div className="border-t border-neutral-100 pt-4">
                <ConfirmAction
                  action={deleteProject.bind(null, project.id)}
                  label="Delete project"
                  variant="danger"
                  title="Delete this project permanently?"
                  body={
                    <>
                      <strong>{project.name}</strong> will be deleted. Its photos stay in the media library. This can&apos;t be undone — archive instead if you might want it back.
                    </>
                  }
                  confirmLabel="Delete permanently"
                  redirectTo="/admin/portfolio"
                />
              </div>
            </div>
          </Card>
          <Card title="Info">
            <DescriptionList
              className="sm:grid-cols-[6.5rem_1fr]"
              items={[
                { label: "Created", value: formatDate(project.createdAt, true) },
                { label: "Updated", value: formatDate(project.updatedAt, true) },
                { label: "Published", value: project.publishedAt ? formatDate(project.publishedAt, true) : null },
                { label: "Photos", value: String(project.images.length) },
              ]}
            />
          </Card>
        </aside>
      </div>
    </>
  );
}
