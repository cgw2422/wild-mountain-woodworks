import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/money";
import { statusLabel } from "@/lib/sales/status";
import type { CustomerLine, CustomerTotals } from "@/lib/sales/views";

/** Server-rendered building blocks for customer quote / invoice / order pages. */

export function DocHeading({
  eyebrow,
  title,
  status,
  children,
}: {
  eyebrow: string;
  title: string;
  status?: { label: string; tone: "neutral" | "good" | "warn" | "bad" };
  children?: React.ReactNode;
}) {
  const tones = {
    neutral: "border-stone-dark text-muted",
    good: "border-success text-success",
    warn: "border-bronze text-bronze-text",
    bad: "border-error text-error",
  };
  return (
    <div className="flex flex-col gap-4 border-b border-stone pb-8 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="eyebrow text-bronze-text">{eyebrow}</p>
        <h1 className="display-lg mt-3">{title}</h1>
        {children}
      </div>
      {status ? (
        <p
          className={cn(
            "inline-flex self-start border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] md:self-auto",
            tones[status.tone],
          )}
        >
          {status.label}
        </p>
      ) : null}
    </div>
  );
}

export function Facts({
  items,
}: {
  items: Array<{ label: string; value: React.ReactNode | null | undefined }>;
}) {
  const shown = items.filter((i) => i.value != null && i.value !== "");
  if (!shown.length) return null;
  return (
    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {shown.map((i) => (
        <div key={i.label}>
          <dt className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted">
            {i.label}
          </dt>
          <dd className="mt-1 whitespace-pre-line text-[0.98rem]">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LinesTable({
  lines,
  showUnit = true,
}: {
  lines: CustomerLine[];
  showUnit?: boolean;
}) {
  return (
    <>
      {/* Phones: stacked lines, so amounts are never cut off. */}
      <ul className="divide-y divide-stone border-y border-stone sm:hidden print:hidden">
        {lines.map((l, i) => (
          <li key={i} className="py-4">
            <div className="flex justify-between gap-4">
              <p
                className={cn(
                  "font-medium",
                  l.kind === "DISCOUNT" && "text-success",
                )}
              >
                {l.description}
              </p>
              <p
                className={cn(
                  "shrink-0 tabular-nums",
                  l.kind === "DISCOUNT" && "text-success",
                )}
              >
                {formatMoney(l.lineTotalCents)}
              </p>
            </div>
            {l.quantity > 1 ? (
              <p className="mt-0.5 text-sm text-muted tabular-nums">
                {l.quantity} × {formatMoney(l.unitPriceCents)}
              </p>
            ) : null}
            {l.notes ? (
              <p className="mt-1 whitespace-pre-line text-sm text-muted">
                {l.notes}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="hidden sm:block print:block">
        <table className="w-full border-collapse text-left text-[0.95rem]">
          <caption className="sr-only">Items</caption>
          <thead>
            <tr className="border-b border-charcoal text-[0.72rem] uppercase tracking-[0.14em] text-muted">
              <th scope="col" className="py-3 pr-4 font-semibold">
                Description
              </th>
              <th
                scope="col"
                className="w-16 py-3 pr-4 text-right font-semibold"
              >
                Qty
              </th>
              {showUnit ? (
                <th
                  scope="col"
                  className="w-28 py-3 pr-4 text-right font-semibold"
                >
                  Price
                </th>
              ) : null}
              <th scope="col" className="w-32 py-3 text-right font-semibold">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-stone align-top">
                <td className="py-4 pr-4">
                  <p
                    className={cn(
                      "font-medium",
                      l.kind === "DISCOUNT" && "text-success",
                    )}
                  >
                    {l.description}
                  </p>
                  {l.notes ? (
                    <p className="mt-1 whitespace-pre-line text-sm text-muted">
                      {l.notes}
                    </p>
                  ) : null}
                </td>
                <td className="py-4 pr-4 text-right tabular-nums">
                  {l.quantity}
                </td>
                {showUnit ? (
                  <td className="py-4 pr-4 text-right tabular-nums">
                    {formatMoney(l.unitPriceCents)}
                  </td>
                ) : null}
                <td
                  className={cn(
                    "py-4 text-right tabular-nums",
                    l.kind === "DISCOUNT" && "text-success",
                  )}
                >
                  {formatMoney(l.lineTotalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function formatMoney(cents: number) {
  return cents < 0
    ? `−${formatCents(-cents, { showZeroCents: true })}`
    : formatCents(cents, { showZeroCents: true });
}

export function TotalsBlock({
  totals,
  extra = [],
}: {
  totals: CustomerTotals;
  extra?: Array<{ label: string; cents: number; strong?: boolean }>;
}) {
  const rows: Array<{
    label: string;
    cents: number;
    strong?: boolean;
    hide?: boolean;
  }> = [
    { label: "Subtotal", cents: totals.subtotalCents },
    {
      label: "Discounts",
      cents: -totals.discountCents,
      hide: !totals.discountCents,
    },
    {
      label: "Delivery",
      cents: totals.deliveryCents,
      hide: !totals.deliveryCents,
    },
    {
      label: "Other charges",
      cents: totals.otherChargesCents,
      hide: !totals.otherChargesCents,
    },
    { label: "Tax", cents: totals.taxCents, hide: !totals.taxCents },
    { label: "Total", cents: totals.totalCents, strong: true },
    ...extra,
  ];
  return (
    <dl className="ml-auto mt-6 w-full max-w-sm space-y-2 text-[0.98rem]">
      {rows
        .filter((r) => !r.hide)
        .map((r) => (
          <div
            key={r.label}
            className={cn(
              "flex justify-between gap-6",
              r.strong && "border-t border-charcoal pt-3 text-lg font-semibold",
            )}
          >
            <dt>{r.label}</dt>
            <dd className="tabular-nums">{formatMoney(r.cents)}</dd>
          </div>
        ))}
    </dl>
  );
}

export function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-10 break-inside-avoid", className)}>
      <h2 className="font-display text-2xl">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Prose({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="whitespace-pre-line leading-relaxed text-charcoal-muted">
      {text}
    </div>
  );
}

export function Files({
  files,
}: {
  files: Array<{ url: string; name: string; mimeType: string }>;
}) {
  if (!files.length) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {files.map((f) => (
        <li key={f.url}>
          <a
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center gap-3 border border-stone bg-paper px-4 py-2 text-sm underline-offset-2 hover:underline"
          >
            {f.name}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function statusPill(status: string): {
  label: string;
  tone: "neutral" | "good" | "warn" | "bad";
} {
  const good = [
    "ACCEPTED",
    "PAID",
    "COMPLETED",
    "CONVERTED_TO_INVOICE",
    "DEPOSIT_PAID",
    "DELIVERED",
  ];
  const warn = [
    "SENT",
    "VIEWED",
    "OPEN",
    "PARTIALLY_PAID",
    "AWAITING_DEPOSIT",
    "DEPOSIT_DUE",
  ];
  const bad = ["DECLINED", "EXPIRED", "CANCELED", "VOID", "PAST_DUE"];
  const label =
    status === "CONVERTED_TO_INVOICE"
      ? "Accepted"
      : status === "VIEWED" || status === "SENT"
        ? "Awaiting your response"
        : status === "OPEN"
          ? "Due"
          : statusLabel(status);
  return {
    label,
    tone: good.includes(status)
      ? "good"
      : warn.includes(status)
        ? "warn"
        : bad.includes(status)
          ? "bad"
          : "neutral",
  };
}
