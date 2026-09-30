import { saleCaption } from "@/lib/pricing/sale";
import { cn } from "@/lib/cn";

/**
 * Small, restrained sale tag for the top-left corner of product imagery:
 * warm ivory on muted bronze. Decorative duplicate of the price text, which
 * carries the accessible sale wording.
 */
export function SaleBadge({ label, percentOff, className }: { label: string | null; percentOff: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute left-3 top-3 z-10 rounded-[2px] bg-bronze-text/95 px-2.5 py-1 text-[0.62rem] font-semibold uppercase leading-none tracking-[0.18em] text-ivory shadow-[0_1px_2px_rgba(31,30,28,0.12)] sm:left-4 sm:top-4",
        className,
      )}
    >
      {saleCaption(label, percentOff)}
    </span>
  );
}
