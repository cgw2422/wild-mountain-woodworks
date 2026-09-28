import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { getProductPage } from "@/lib/catalog/queries";
import { SiteChrome } from "@/components/site/SiteChrome";
import { PreviewBanner } from "@/components/site/PreviewBanner";
import { ProductView } from "@/components/product/ProductView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

/** Secure preview of any product (including drafts) exactly as it will appear publicly. */
export default async function ProductPreview({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const data = await getProductPage({ id }, true);
  if (!data) notFound();
  return (
    <SiteChrome
      banner={
        <PreviewBanner
          status={data.product.status}
          editHref={`/admin/products/${id}`}
          liveHref={data.product.status === "ACTIVE" ? `/furniture/${data.product.slug}` : null}
        />
      }
    >
      <ProductView data={data} />
    </SiteChrome>
  );
}
