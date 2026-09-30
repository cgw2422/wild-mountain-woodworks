import { formatDate } from "@/components/admin/ui";

type Item = { id: string; type: string; message: string; createdAt: Date };

const ICON: Record<string, string> = {
  quote: "Q",
  invoice: "I",
  payment: "$",
  order: "O",
  communication: "✎",
  email: "@",
};

/** Customer timeline (quote, invoice, payment, production, communications). */
export function Timeline({ items }: { items: Item[] }) {
  if (!items.length) return <p className="text-sm text-neutral-500">No activity yet.</p>;
  return (
    <ol className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="flex gap-3 text-sm">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-600" aria-hidden="true">
            {ICON[a.type.split(".")[0]!] ?? "•"}
          </span>
          <div className="min-w-0">
            <p className="[overflow-wrap:anywhere]">{a.message}</p>
            <p className="text-xs text-neutral-500">{formatDate(a.createdAt, true)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
