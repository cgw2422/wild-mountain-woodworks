import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {requirePermission} from "@/lib/auth/session";
import { getMediaUsage } from "@/lib/media/service";
import { Badge, Card, DescriptionList, PageHeader, formatBytes, formatDate } from "@/components/admin/ui";
import { deleteMediaItem, updateMediaDetails } from "../actions";
import { DeleteMedia } from "./DeleteMedia";
import { MediaEditor } from "./MediaEditor";
import { ReplaceFile } from "./ReplaceFile";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const m = await prisma.media.findUnique({ where: { id }, select: { originalName: true } });
  return { title: m?.originalName ?? "Image" };
}

export default async function MediaDetail({ params }: Props) {
  await requirePermission("media");
  const { id } = await params;
  const media = await prisma.media.findUnique({ where: { id }, include: { uploadedBy: { select: { name: true, email: true } } } });
  if (!media) notFound();
  const usage = await getMediaUsage(id);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Media", href: "/admin/media" }, { label: media.originalName }]}
        title={<span className="break-all">{media.originalName}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {usage.length ? <Badge tone="green">Used in {usage.length} place{usage.length === 1 ? "" : "s"}</Badge> : <Badge>Unused</Badge>}
            {!media.alt ? <Badge tone="amber">Missing alt text</Badge> : null}
            {media.isSample ? <Badge tone="violet">Sample content</Badge> : null}
          </span>
        }
        actions={
          <a href={media.url} target="_blank" rel="noopener" className="text-sm text-neutral-700 underline hover:text-neutral-900">
            Open original ↗
          </a>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <MediaEditor
            key={media.url}
            action={updateMediaDetails.bind(null, id)}
            media={{
              url: media.url,
              alt: media.alt,
              caption: media.caption,
              width: media.width,
              height: media.height,
              focalX: media.focalX,
              focalY: media.focalY,
              blurDataUrl: media.blurDataUrl,
            }}
          />
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="Where it's used" description={usage.length ? "Changes here update all of these." : undefined}>
            {usage.length ? (
              <ul className="space-y-1.5 text-sm">
                {usage.map((u, i) => (
                  <li key={`${u.href}-${i}`}>
                    <Link href={u.href} className="text-neutral-800 underline hover:text-neutral-950">
                      {u.label}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">Not used anywhere yet. Choose it from any image field (Change image → Media library).</p>
            )}
          </Card>

          <Card title="Details">
            <DescriptionList
              className="sm:grid-cols-[7rem_1fr]"
              items={[
                { label: "Original name", value: media.originalName },
                { label: "Stored as", value: <span className="font-mono text-xs">{media.filename}</span> },
                { label: "Type", value: media.mimeType },
                { label: "File size", value: formatBytes(media.size) },
                { label: "Dimensions", value: `${media.width} × ${media.height} px` },
                { label: "Uploaded", value: formatDate(media.createdAt, true) },
                { label: "Uploaded by", value: media.uploadedBy ? media.uploadedBy.name : media.isSample ? "Sample content" : null },
                { label: "Last changed", value: formatDate(media.updatedAt, true) },
              ]}
            />
          </Card>

          <Card title="Replace file">
            <ReplaceFile id={id} usageCount={usage.length} />
          </Card>

          <Card title="Delete">
            <p className="mb-3 text-sm text-neutral-600">
              {usage.length
                ? "This image is in use. You'll see every location before anything is removed."
                : "This image isn't used anywhere and can be deleted safely."}
            </p>
            <DeleteMedia name={media.originalName} usage={usage} onDelete={deleteMediaItem.bind(null, id)} />
          </Card>
        </div>
      </div>
    </>
  );
}
