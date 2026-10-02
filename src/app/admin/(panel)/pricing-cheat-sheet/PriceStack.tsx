import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/money";
import type { CheatPrice } from "@/lib/pricing/cheat-sheet";

/** One price: the sale price in bold with the regular price struck through while a sale is active; otherwise the price. */
export function PriceStack({ price, className, large = false }: { price: CheatPrice | null | undefined; className?: string; large?: boolean }) {
  if (!price) return <span className={cn("text-neutral-400", className)}>—</span>;
  const onSale = price.savingsCents > 0;
  return (
    <span className={cn("inline-flex flex-wrap items-baseline justify-end gap-x-1.5 tabular-nums", className)}>
      {onSale ? (
        <del className={cn("text-neutral-400 decoration-1", large ? "text-base" : "text-xs")} aria-label={`Regular ${formatCents(price.regularCents)}`}>
          {formatCents(price.regularCents)}
        </del>
      ) : null}
      <span className={cn("font-semibold", onSale ? "text-red-700" : "text-neutral-900", large ? "text-2xl" : "text-sm")}>
        {onSale ? <span className="sr-only">Sale </span> : null}
        {formatCents(price.totalCents)}
      </span>
    </span>
  );
}
