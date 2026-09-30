import Link from "next/link";
import { CmsImage } from "@/components/media/CmsImage";
import { PriceTag } from "@/components/product/PriceTag";
import { SaleBadge } from "@/components/product/SaleBadge";
import type { ProductCardData } from "@/lib/catalog/queries";
import { cn } from "@/lib/cn";

export function ProductCard({ product, priority, className }: { product: ProductCardData; priority?: boolean; className?: string }) {
  return (
    <article className={cn("group relative", className)}>
      <div>
        <div className="zoom-on-hover relative overflow-hidden">
          <CmsImage image={product.image} slot="productCard" priority={priority} alt={product.image?.alt || product.name} />
          {product.secondaryImage ? (
            <div className="absolute inset-0 opacity-0 transition-opacity duration-700 group-hover:opacity-100 [@media(hover:none)]:hidden">
              <CmsImage image={product.secondaryImage} slot="productCard" alt="" className="h-full" />
            </div>
          ) : null}
          {product.sale ? <SaleBadge label={product.sale.label} percentOff={product.sale.percentOff} /> : null}
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-2">
        {product.categoryName ? <p className="eyebrow text-[0.66rem] text-muted">{product.categoryName}</p> : null}
        <h3 className="font-display text-[1.65rem] leading-tight text-charcoal">
          <Link href={`/furniture/${product.slug}`} className="after:absolute after:inset-0 after:outline-offset-4 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-bronze-text">
            {product.name}
          </Link>
        </h3>
        {product.shortDescription ? <p className="max-w-md text-[0.93rem] leading-relaxed text-muted">{product.shortDescription}</p> : null}
        <div className="mt-2 flex items-center justify-between gap-4">
          <span className="text-[0.74rem] font-semibold uppercase tracking-[0.16em] text-charcoal">
            <span className="link-underline group-hover:[background-size:100%_1px]">View Piece</span>
          </span>
          {product.startingPriceCents != null ? (
            <PriceTag cents={product.startingPriceCents} regularCents={product.regularPriceCents} showCaption={false} className="justify-end text-right text-[0.9rem] text-charcoal" />
          ) : null}
        </div>
      </div>
    </article>
  );
}
