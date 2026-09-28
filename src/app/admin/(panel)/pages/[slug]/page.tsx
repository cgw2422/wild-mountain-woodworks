import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { getPageDefinition } from "@/lib/cms/definitions";
import { ActionButton, ActionForm, SubmitButton, TextArea } from "@/components/admin/forms";
import { MarkdownEditor } from "@/components/admin/content/MarkdownEditor";
import { SectionEditor } from "@/components/admin/content/SectionEditor";
import { PageSettingsForm } from "@/components/admin/content/PageSettingsForm";
import { AdminLinkButton, Card, PageHeader, StatusBadge, formatDate } from "@/components/admin/ui";
import { flagPageForReview, markPageReviewed, savePageBody, savePageSettings, saveSection } from "../actions";
import { linkSuggestions, loadPageForEditor } from "../data";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: getPageDefinition(slug)?.title ?? "Page" };
}

export default async function EditPage({ params }: Props) {
  await requireAdmin();
  const { slug } = await params;
  if (slug === "home") redirect("/admin/homepage");
  const def = getPageDefinition(slug);
  if (!def) notFound();

  const { page, sections } = await loadPageForEditor(def);
  const links = linkSuggestions();
  const isPolicy = def.kind === "policy";
  const sharedTemplate = slug === "product" || slug === "portfolio-project";
  const status = page?.status ?? "PUBLISHED";

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Pages", href: "/admin/pages" }, { label: def.title }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {def.title} <StatusBadge status={status} />
          </span>
        }
        description={
          <>
            {def.description}
            {page ? ` Last updated ${formatDate(page.updatedAt, true)}.` : " Not edited yet — defaults are shown on the site until you save."}
          </>
        }
        actions={
          sharedTemplate ? null : (
            <AdminLinkButton href={def.path} target="_blank">
              View page ↗
            </AdminLinkButton>
          )
        }
      />

      <div className="space-y-6">
        {page?.reviewRequired ? (
          <div role="region" aria-label="Review required" className="rounded-md border border-amber-300 bg-amber-50 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 max-w-3xl">
                <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                  <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0" fill="currentColor" aria-hidden="true">
                    <path d="M10 2 1 18h18L10 2Zm-.9 6h1.8v5H9.1V8Zm0 6.5h1.8v1.8H9.1v-1.8Z" />
                  </svg>
                  Needs owner/legal review
                </p>
                <p className="mt-2 whitespace-pre-line text-sm text-amber-900">
                  {page.reviewNotes || "This page contains draft language. Review it carefully before relying on it."}
                </p>
              </div>
              <ActionButton action={markPageReviewed.bind(null, slug)} variant="secondary" pendingLabel="Saving…" successMessage="Marked as reviewed.">
                Mark as reviewed
              </ActionButton>
            </div>
          </div>
        ) : null}

        {sections.length > 1 ? (
          <nav aria-label="Sections on this page" className="flex flex-wrap gap-2 text-sm">
            <span className="text-neutral-500">Jump to:</span>
            <a href="#page-settings" className="text-neutral-700 underline hover:text-neutral-900">
              Page settings
            </a>
            {def.hasBody ? (
              <a href="#page-body" className="text-neutral-700 underline hover:text-neutral-900">
                Page text
              </a>
            ) : null}
            {def.sections.map((s) => (
              <a key={s.key} href={`#section-${s.key}`} className="inline-block py-1 text-neutral-700 underline hover:text-neutral-900">
                {s.label}
              </a>
            ))}
          </nav>
        ) : null}

        <Card id="page-settings" title="Page settings & SEO" description="How this page appears in search results and when shared on social media.">
          <PageSettingsForm
            action={savePageSettings.bind(null, slug)}
            title={page?.title ?? def.title}
            defaultTitle={def.title}
            status={status}
            canDraft={isPolicy}
            seoTitle={page?.seoTitle ?? null}
            seoDescription={page?.seoDescription ?? null}
            ogImage={page?.ogImage ?? null}
          />
        </Card>

        {def.hasBody ? (
          <Card id="page-body" title="Page text" description="The main content of this page.">
            <ActionForm action={savePageBody.bind(null, slug)} className="space-y-4" successMessage="Page text saved — live on the site now.">
              <MarkdownEditor name="body" label="Body (Markdown)" defaultValue={page?.body ?? ""} rows={22} />
              <div className="flex justify-end border-t border-neutral-100 pt-4">
                <SubmitButton>Save page text</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ) : null}

        {def.sections.map((sd, i) => (
          <SectionEditor
            key={sd.key}
            id={`section-${sd.key}`}
            definition={sd}
            value={sections[i]!}
            action={saveSection.bind(null, slug, sd.key)}
            linkSuggestions={links}
          />
        ))}

        {!page?.reviewRequired ? (
          <Card title="Review flag" description="Flag this page if its wording needs to be checked by the owner or a legal professional. It shows a “Needs review” badge in the admin only.">
            <ActionForm action={flagPageForReview.bind(null, slug)} className="space-y-4" successMessage="Flagged for review.">
              <TextArea name="reviewNotes" label="What needs reviewing? (optional)" rows={3} defaultValue={page?.reviewNotes ?? ""} maxLength={2000} />
              <div className="flex justify-end">
                <SubmitButton variant="secondary">Flag for review</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
