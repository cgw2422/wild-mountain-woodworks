import { formatCents } from "@/lib/money";
import { cn } from "@/lib/cn";

export function money(cents: number) {
  return cents < 0 ? `−${formatCents(-cents, { showZeroCents: true })}` : formatCents(cents, { showZeroCents: true });
}

export function Money({ cents, className }: { cents: number | null | undefined; className?: string }) {
  if (cents == null) return <span className="text-neutral-400">—</span>;
  return <span className={cn("tabular-nums", className)}>{money(cents)}</span>;
}
