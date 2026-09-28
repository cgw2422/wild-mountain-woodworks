import Link from "next/link";
import { CmsImage } from "@/components/media/CmsImage";
import type { PortfolioCardData } from "@/lib/catalog/queries";
import { cn } from "@/lib/cn";

export function PortfolioCard({
  project,
  natural,
  className,
  sizes,
}: {
  project: PortfolioCardData;
  /** Keep the photo's own proportions (masonry layouts). */
  natural?: boolean;
  className?: string;
  sizes?: string;
}) {
  const meta = [project.furnitureType, project.wood].filter(Boolean).join(" · ");
  return (
    <article className={cn("group relative", className)}>
      <div className="zoom-on-hover overflow-hidden">
        <CmsImage
          image={project.image}
          slot="portfolioCard"
          ratio={natural && project.image ? project.image.width / project.image.height : undefined}
          alt={project.image?.alt || project.name}
          sizes={sizes}
        />
      </div>
      <div className="mt-4">
        {meta ? <p className="eyebrow text-[0.66rem] text-muted">{meta}</p> : null}
        <h3 className="mt-2 font-display text-2xl leading-tight">
          <Link href={`/our-work/${project.slug}`} className="after:absolute after:inset-0 after:outline-offset-4 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-bronze-text">
            <span className="link-underline group-hover:[background-size:100%_1px]">{project.name}</span>
          </Link>
        </h3>
      </div>
    </article>
  );
}
