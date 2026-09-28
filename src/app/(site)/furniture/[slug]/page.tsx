import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPageContent } from "@/lib/cms/queries";
import { buildMetadata, plainText } from "@/lib/seo";
import { getCatalogProducts, getNavCategories, getProductPage, getPublicCategoryBySlug } from "@/lib/catalog/queries";
import { CatalogView } from "@/components/site/CatalogView";
import { PageHero } from "@/components/site/PageHero";
import { ProductView } from "@/components/product/ProductView";

/**
 * /furniture/[slug] serves both category listings (/furniture/dining-tables)
 * and product pages (/furniture/ridge-dining-table). Slugs are unique across
 * both (enforced in admin), categories are checked first.
 */
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = await getPublicCategoryBySlug(slug);
  if (category && !category.linkUrl) {
    return buildMetadata({
      title: category.seoTitle || category.name,
      description: category.seoDescription || category.description,
      path: `/furniture/${category.slug}`,
      image: category.image,
    });
  }
  const data = await getProductPage({ slug });
  if (!data) return { title: "Not found", robots: { index: false } };
  const { product, images } = data;
  return buildMetadata({
    title: product.seoTitle || product.name,
    description: product.seoDescription || product.shortDescription || plainText(product.description),
    path: `/furniture/${product.slug}`,
    image: images[0] ?? null,
  });
}

export default async function FurnitureSlugPage({ params }: Props) {
  const { slug } = await params;

  const category = await getPublicCategoryBySlug(slug);
  if (category && !category.linkUrl) {
    const [page, categories, products] = await Promise.all([getPageContent("furniture"), getNavCategories(), getCatalogProducts(category.id)]);
    return (
      <>
        <PageHero
          section={{
            ...page.section("hero"),
            eyebrow: "Furniture",
            heading: category.name,
            body: category.description,
            image: category.image,
            primaryCta: null,
          }}
          fallbackTitle={category.name}
          breadcrumbs={[{ label: "Furniture", href: "/furniture" }, { label: category.name }]}
        />
        <div className="pt-10">
          <CatalogView categories={categories} activeSlug={category.slug} products={products} customCta={page.section("custom-cta")} />
        </div>
      </>
    );
  }

  const data = await getProductPage({ slug });
  if (!data) notFound();
  return <ProductView data={data} />;
}
