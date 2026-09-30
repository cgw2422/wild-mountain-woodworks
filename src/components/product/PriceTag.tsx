import { formatCents } from "@/lib/money";
import { percentOff, saleCaption } from "@/lib/pricing/sale";
import { cn } from "@/lib/cn";

/**
 * "From $1,399", or during a sale "From ~~$1,399~~ $979  SALE · 30% OFF".
 * Prices come from the server-side pricing engine; this only formats them.
 * The percentage is derived from the two prices shown, rounded down.
 */
export function PriceTag({
  cents,
  regularCents,
  label,
  prefix = "From ",
  showCaption = true,
  className,
}: {
  cents: number;
  regularCents?: number | null;
  label?: string | null;
  prefix?: string;
  /** The "SALE · 30% OFF" caption (hidden on cards, where the image badge carries it). */
  showCaption?: boolean;
  className?: string;
}) {
  const onSale = regularCents != null && regularCents > cents;
  return (
    <span className={cn("nums inline-flex flex-wrap items-baseline gap-x-3 gap-y-1", className)}>
      <span>
        {prefix ? <span className="text-muted">{prefix}</span> : null}
        {onSale ? (
          <>
            <del className="text-muted decoration-muted/70 decoration-1">
              <span className="sr-only">Regular price </span>
              {formatCents(regularCents)}
            </del>{" "}
            <ins className="font-semibold text-bronze-text no-underline">
              <span className="sr-only">Sale price </span>
              {formatCents(cents)}
            </ins>
          </>
        ) : (
          formatCents(cents)
        )}
      </span>
      {onSale && showCaption ? (
        <span className="text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-bronze-text">{saleCaption(label, percentOff(regularCents, cents))}</span>
      ) : null}
    </span>
  );
}
