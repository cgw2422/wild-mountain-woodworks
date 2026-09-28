import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildMetadata, plainText } from "@/lib/seo";
import { getPortfolioProject } from "@/lib/catalog/queries";
import { ProjectView } from "@/components/portfolio/ProjectView";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPortfolioProject({ slug });
  if (!data) return { title: "Not found", robots: { index: false } };
  return buildMetadata({
    title: data.project.seoTitle || data.project.name,
    description: data.project.seoDescription || data.project.summary || plainText(data.project.description),
    path: `/our-work/${data.project.slug}`,
    image: data.images[0] ?? null,
    type: "article",
  });
}

export default async function ProjectPage({ params }: Props) {
  const { slug } = await params;
  const data = await getPortfolioProject({ slug });
  if (!data) notFound();
  return <ProjectView data={data} />;
}
