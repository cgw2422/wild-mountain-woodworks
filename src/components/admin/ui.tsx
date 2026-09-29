import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Admin presentational components. The admin is intentionally utilitarian:
 * clear tables, forms and cards, optimized for speed on desktop/tablet.
 */

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-neutral-200 pb-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {breadcrumbs?.length ? (
          <nav aria-label="Breadcrumb" className="mb-2 text-xs text-neutral-500">
            <ol className="flex flex-wrap items-center gap-1.5">
              {breadcrumbs.map((b, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  {b.href ? (
                    <Link href={b.href} className="inline-block py-1 hover:text-neutral-900 hover:underline">
                      {b.label}
                    </Link>
                  ) : (
                    <span aria-current="page">{b.label}</span>
                  )}
                  {i < breadcrumbs.length - 1 ? <span aria-hidden="true">/</span> : null}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1 className="truncate text-2xl font-semibold tracking-tight text-neutral-900">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-neutral-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded-md border border-neutral-200 bg-white", className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 px-5 py-4">
          <div>
            {title ? <h2 className="text-base font-semibold text-neutral-900">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-sm text-neutral-500">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-neutral-300 bg-white px-6 py-14 text-center">
      <div className="mb-4 text-neutral-400" aria-hidden="true">
        {icon ?? (
          <svg viewBox="0 0 100 22" className="h-6 w-24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 21 L25 9.5 L33 12.6 L50 1 L64 11 L72 8.2 L99 21" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>
      <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm text-neutral-600">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

const badgeTones = {
  neutral: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
  dark: "bg-neutral-800 text-white ring-neutral-800",
} as const;
export type BadgeTone = keyof typeof badgeTones;

export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset", badgeTones[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, BadgeTone> = {
  DRAFT: "neutral",
  ACTIVE: "green",
  PUBLISHED: "green",
  ARCHIVED: "amber",
  NEW: "blue",
  UNREAD: "blue",
  READ: "neutral",
  REPLIED: "green",
  REVIEWING: "violet",
  CONTACTED: "violet",
  QUOTED: "amber",
  ACCEPTED: "green",
  DECLINED: "red",
  COMPLETED: "dark",
  PENDING_PAYMENT: "amber",
  PAID: "green",
  CANCELLED: "red",
  REFUNDED: "red",
};

export function humanizeEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{humanizeEnum(status)}</Badge>;
}

export function Stat({ label, value, href, hint }: { label: string; value: React.ReactNode; href?: string; hint?: string }) {
  const inner = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-neutral-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-neutral-500">{hint}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-md border border-neutral-200 bg-white p-5 transition hover:border-neutral-400">
      {inner}
    </Link>
  ) : (
    <div className="rounded-md border border-neutral-200 bg-white p-5">{inner}</div>
  );
}

/** Table styling helpers — tables stay semantic <table> markup. */
export const table = {
  wrap: "relative overflow-x-auto rounded-md border border-neutral-200 bg-white",
  table: "min-w-full divide-y divide-neutral-200 text-sm",
  thead: "bg-neutral-50",
  th: "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap",
  tbody: "divide-y divide-neutral-100",
  tr: "hover:bg-neutral-50/70",
  td: "px-4 py-3 align-middle text-neutral-800",
};

export function DescriptionList({ items, className }: { items: Array<{ label: string; value: React.ReactNode }>; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[minmax(8rem,auto)_1fr]", className)}>
      {items.map((it) => (
        <div key={it.label} className="contents">
          <dt className="text-sm text-neutral-500">{it.label}</dt>
          <dd className="text-sm text-neutral-900 [overflow-wrap:anywhere]">{it.value ?? <span className="text-neutral-400">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export const adminButton = {
  primary:
    "inline-flex h-9 items-center justify-center gap-2 rounded bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50",
  secondary:
    "inline-flex h-9 items-center justify-center gap-2 rounded border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50",
  danger:
    "inline-flex h-9 items-center justify-center gap-2 rounded border border-red-300 bg-white px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50",
  ghost:
    "inline-flex h-9 items-center justify-center gap-2 rounded px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50",
  small:
    "inline-flex h-8 items-center justify-center gap-1.5 rounded border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50",
};

export function AdminLinkButton({
  href,
  children,
  variant = "secondary",
  className,
  target,
}: {
  href: string;
  children: React.ReactNode;
  variant?: keyof typeof adminButton;
  className?: string;
  target?: string;
}) {
  return (
    <Link href={href} className={cn(adminButton[variant], className)} target={target} rel={target ? "noopener" : undefined}>
      {children}
    </Link>
  );
}

export function formatDate(d: Date | string | null | undefined, withTime = false) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
