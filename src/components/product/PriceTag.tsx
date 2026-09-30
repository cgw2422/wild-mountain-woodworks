import { formatCents } from "@/lib/money";
import { percentOff } from "@/lib/pricing/sale";
import { cn } from "@/lib/cn";

/**
 * "From $1,200", or during a sale "From ~~$1,500~~ $1,200 · Sale". Prices
 * come from the server-side pricing engine; this only formats them.
 */
export function PriceTag({
  cents,
  regularCents,
  prefix = "From ",
  showPercent = false,
  className,
}: {
  cents: number;
  regularCents?: number | null;
  prefix?: string;
  showPercent?: boolean;
  className?: string;
}) {
  const onSale = regularCents != null && regularCents > cents;
  const pct = onSale ? percentOff(regularCents, cents) : 0;
  return (
    <span className={cn("nums inline-flex flex-wrap items-baseline gap-x-2", className)}>
      <span>
        {prefix ? <span className="text-muted">{prefix}</span> : null}
        {onSale ? (
          <>
            <del className="text-muted decoration-1">
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
      {onSale ? (
        <span className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-bronze-text">
          Sale{showPercent && pct > 0 ? ` · ${pct}% off` : ""}
        </span>
      ) : null}
    </span>
  );
}
