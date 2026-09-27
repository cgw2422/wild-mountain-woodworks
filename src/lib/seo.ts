import "server-only";
import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import { getSiteOrigin, siteUrl } from "@/lib/site-url";

interface MetaInput {
  title?: string | null;
  description?: string | null;
  path: string;
  image?: { url: string; width?: number; height?: number; alt?: string } | null;
  noIndex?: boolean;
  type?: "website" | "article";
}

function absolute(url: string) {
  return url.startsWith("http") ? url : `${getSiteOrigin()}${url}`;
}

/** Page metadata with canonical URL, OpenGraph and Twitter cards. */
export async function buildMetadata(input: MetaInput): Promise<Metadata> {
  const settings = await getSettings();
  const siteName = settings.businessName;
  const title = input.title?.trim() || settings.defaultSeoTitle || siteName;
  const description = input.description?.trim() || settings.defaultSeoDescription || settings.tagline;
  const image = input.image ?? settings.defaultOgImage;
  const images = image
    ? [{ url: absolute(image.url), width: image.width, height: image.height, alt: image.alt || title }]
    : undefined;
  return {
    title,
    description,
    alternates: { canonical: siteUrl(input.path) },
    openGraph: {
      title,
      description,
      url: siteUrl(input.path),
      siteName,
      type: input.type ?? "website",
      locale: "en_US",
      images,
    },
    twitter: { card: images ? "summary_large_image" : "summary", title, description, images: images?.map((i) => i.url) },
    robots: input.noIndex ? { index: false, follow: false } : undefined,
  };
}

export function absoluteUrl(path: string) {
  return siteUrl(path);
}

export function toAbsoluteImage(url: string) {
  return absolute(url);
}

/** Strip markdown to plain text for meta descriptions. */
export function plainText(md: string | null | undefined, max = 160): string {
  if (!md) return "";
  const text = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : text;
}
