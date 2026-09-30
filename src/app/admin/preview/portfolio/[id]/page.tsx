import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {requirePermission} from "@/lib/auth/session";
import { getPortfolioProject } from "@/lib/catalog/queries";
import { SiteChrome } from "@/components/site/SiteChrome";
import { PreviewBanner } from "@/components/site/PreviewBanner";
import { ProjectView } from "@/components/portfolio/ProjectView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

export default async function PortfolioPreview({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("content");
  const { id } = await params;
  const data = await getPortfolioProject({ id }, true);
  if (!data) notFound();
  return (
    <SiteChrome
      banner={
        <PreviewBanner
          status={data.project.status}
          editHref={`/admin/portfolio/${id}`}
          liveHref={data.project.status === "PUBLISHED" ? `/our-work/${data.project.slug}` : null}
        />
      }
    >
      <ProjectView data={data} />
    </SiteChrome>
  );
}
