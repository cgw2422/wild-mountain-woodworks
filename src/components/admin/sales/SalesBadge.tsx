import { Badge } from "@/components/admin/ui";
import { statusLabel, statusTone } from "@/lib/sales/status";

/** Status badge for quotes, revisions, invoices, orders and payments. */
export function SalesBadge({ status, prefix }: { status: string; prefix?: string }) {
  return (
    <Badge tone={statusTone(status)}>
      {prefix ? `${prefix}: ` : ""}
      {statusLabel(status)}
    </Badge>
  );
}
