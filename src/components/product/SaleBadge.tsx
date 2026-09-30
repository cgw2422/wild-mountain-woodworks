import { saleCaption } from "@/lib/pricing/sale";
import { cn } from "@/lib/cn";

/**
 * Sale tag for the top-left corner of product imagery: warm ivory on solid
 * muted bronze, with a soft lift so it reads against light and dark photos.
 * Sized responsively — compact on phones, clearly visible on desktop — and
 * one step larger on the product page's main image (`size="hero"`).
 * Decorative duplicate of the price text, which carries the accessible
 * sale wording.
 */
const SIZES = {
  card: "left-3 top-3 px-3 py-[0.45rem] text-[0.72rem] sm:left-4 sm:top-4 sm:px-3.5 sm:py-2 sm:text-[0.78rem] lg:px-4 lg:text-[0.82rem]",
  hero: "left-3 top-3 px-3 py-[0.45rem] text-[0.74rem] sm:left-4 sm:top-4 sm:px-4 sm:py-2.5 sm:text-[0.84rem] lg:left-5 lg:top-5 lg:px-[1.1rem] lg:text-[0.9rem]",
} as const;

export function SaleBadge({
  label,
  percentOff,
  size = "card",
  className,
}: {
  label: string | null;
  percentOff: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute z-10 inline-flex items-center whitespace-nowrap rounded-[3px] bg-bronze-text font-semibold uppercase leading-none tracking-[0.14em] text-ivory",
        "shadow-[0_2px_10px_rgba(31,30,28,0.22),0_1px_2px_rgba(31,30,28,0.18)] ring-1 ring-inset ring-ivory/15",
        SIZES[size],
        className,
      )}
    >
      {saleCaption(label, percentOff)}
    </span>
  );
}
