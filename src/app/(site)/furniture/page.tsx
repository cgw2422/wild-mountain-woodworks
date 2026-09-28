import type { Metadata } from "next";
import { getPageContent } from "@/lib/cms/queries";
import { buildMetadata } from "@/lib/seo";
import { getCatalogProducts, getNavCategories } from "@/lib/catalog/queries";
import { PageHero } from "@/components/site/PageHero";
import { CatalogView } from "@/components/site/CatalogView";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPageContent("furniture");
  return buildMetadata({ title: page.seoTitle ?? "Furniture", description: page.seoDescription, path: "/furniture", image: page.ogImage ?? page.section("hero").image });
}

export default async function FurniturePage() {
  const [page, categories, products] = await Promise.all([getPageContent("furniture"), getNavCategories(), getCatalogProducts()]);
  return (
    <>
      <PageHero section={page.section("hero")} fallbackTitle="Furniture" breadcrumbs={[{ label: "Furniture" }]} />
      <div className="pt-10">
        <CatalogView categories={categories} products={products} customCta={page.section("custom-cta")} />
      </div>
    </>
  );
}
