import type { Metadata } from "next";
import { NOT_FOUND_METADATA, getVisiblePage, requireVisiblePage, withPreviewRobots } from "@/lib/cms/pages";
import { buildMetadata } from "@/lib/seo";
import { countSaleProducts, getCatalogProducts, getNavCategories } from "@/lib/catalog/queries";
import { PageHero } from "@/components/site/PageHero";
import { CatalogView } from "@/components/site/CatalogView";

export async function generateMetadata(): Promise<Metadata> {
  const visible = await getVisiblePage("furniture");
  if (!visible) return NOT_FOUND_METADATA;
  const page = visible.page;
  return withPreviewRobots(visible, buildMetadata({ title: page.seoTitle ?? "Furniture", description: page.seoDescription, path: "/furniture", image: page.ogImage ?? page.section("hero").image }));
}

export default async function FurniturePage() {
  const [page, categories, products, saleCount] = await Promise.all([requireVisiblePage("furniture").then((v) => v.page), getNavCategories(), getCatalogProducts(), countSaleProducts()]);
  return (
    <>
      <PageHero section={page.section("hero")} fallbackTitle="Furniture" breadcrumbs={[{ label: "Furniture" }]} />
      <div className="pt-10">
        <CatalogView categories={categories} products={products} customCta={page.section("custom-cta")} saleCount={saleCount} />
      </div>
    </>
  );
}
