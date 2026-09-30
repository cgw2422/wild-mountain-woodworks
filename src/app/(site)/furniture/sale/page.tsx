import type { Metadata } from "next";
import { getPageContent } from "@/lib/cms/queries";
import { buildMetadata } from "@/lib/seo";
import { countSaleProducts, getNavCategories, getSaleProducts } from "@/lib/catalog/queries";
import { PageHero } from "@/components/site/PageHero";
import { CatalogView } from "@/components/site/CatalogView";

/**
 * Every piece whose sale is running right now, decided per request from each
 * product's sale settings — no hand-picked list, and no redeploy when a sale
 * starts or ends.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [page, count] = await Promise.all([getPageContent("sale"), countSaleProducts()]);
  const meta = buildMetadata({
    title: page.seoTitle ?? "Sale",
    description: page.seoDescription,
    path: "/furniture/sale",
    image: page.ogImage ?? page.section("hero").image,
  });
  // Keep an empty sale page out of search results.
  return count > 0 ? meta : { ...meta, robots: { index: false, follow: true } };
}

export default async function SalePage() {
  const [page, furniture, categories, products] = await Promise.all([getPageContent("sale"), getPageContent("furniture"), getNavCategories(), getSaleProducts()]);
  return (
    <>
      <PageHero
        section={page.section("hero")}
        fallbackTitle="Sale"
        breadcrumbs={[{ label: "Furniture", href: "/furniture" }, { label: "Sale" }]}
      />
      <div className="pt-10">
        <CatalogView
          categories={categories}
          activeSlug="sale"
          products={products}
          saleCount={products.length}
          customCta={furniture.section("custom-cta")}
          empty={page.section("empty")}
        />
      </div>
    </>
  );
}
