import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { announcementStatus } from "@/lib/promotions/announcement";
import { countSaleProducts } from "@/lib/catalog/queries";
import { AdminLinkButton, Badge, Card, PageHeader, formatDate, table } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { NewAnnouncementForm } from "./NewAnnouncementForm";

export const metadata: Metadata = { title: "Promotions" };
export const dynamic = "force-dynamic";

const STATUS = {
  live: <Badge tone="green">Showing now</Badge>,
  scheduled: <Badge tone="blue">Scheduled</Badge>,
  ended: <Badge tone="neutral">Ended</Badge>,
  off: <Badge tone="neutral">Off</Badge>,
} as const;

export default async function PromotionsPage() {
  await requireAdmin();
  const [announcements, onSale] = await Promise.all([
    prisma.announcement.findMany({ orderBy: [{ updatedAt: "desc" }] }),
    countSaleProducts(),
  ]);
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Promotions"
        description="The announcement bar above the site's main navigation, and your sale collection."
        actions={
          <AdminLinkButton href="/furniture/sale" target="_blank">
            View sale page ↗
          </AdminLinkButton>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <Card
          title="Announcement bar"
          description="Only one bar shows at a time: the enabled announcement inside its dates (the most recently started wins if they overlap). It appears and disappears on schedule automatically."
        >
          {announcements.length ? (
            <div className={table.wrap}>
              <table className={table.table}>
                <thead className={table.thead}>
                  <tr>
                    <th scope="col" className={table.th}>Announcement</th>
                    <th scope="col" className={table.th}>Status</th>
                    <th scope="col" className={table.th}>Schedule</th>
                    <th scope="col" className={table.th}>Updated</th>
                  </tr>
                </thead>
                <tbody className={table.tbody}>
                  {announcements.map((a) => (
                    <tr key={a.id} className={table.tr}>
                      <td className={cn(table.td, "min-w-[14rem]")}>
                        <Link href={`/admin/promotions/${a.id}`} className="font-medium text-neutral-900 hover:underline">
                          {a.name}
                        </Link>
                        <p className="max-w-md truncate text-xs text-neutral-500">{a.message}</p>
                      </td>
                      <td className={table.td}>{STATUS[announcementStatus(a, now)]}</td>
                      <td className={cn(table.td, "whitespace-nowrap text-xs text-neutral-600")}>
                        {a.startsAt ? `From ${formatDate(a.startsAt, true)}` : "Starts when enabled"}
                        <br />
                        {a.endsAt ? `Until ${formatDate(a.endsAt, true)}` : "No end date"}
                      </td>
                      <td className={cn(table.td, "whitespace-nowrap text-neutral-600")}>{formatDate(a.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-neutral-600">No announcements yet.</p>
          )}
          <div className="mt-6 border-t border-neutral-100 pt-5">
            <h3 className="mb-3 text-sm font-semibold text-neutral-900">New announcement</h3>
            <NewAnnouncementForm />
          </div>
        </Card>

        <Card title="Sale collection" description="Sales are set on each product (Products → a product → Pricing). The sale page lists every piece whose sale is running right now.">
          <p className="text-sm text-neutral-700">
            {onSale === 0 ? "No pieces are on sale right now." : `${onSale} ${onSale === 1 ? "piece is" : "pieces are"} on sale right now.`}{" "}
            Link the announcement to <code className="rounded bg-neutral-100 px-1">/furniture/sale</code> to send visitors there.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <AdminLinkButton href="/admin/products">Products</AdminLinkButton>
            <AdminLinkButton href="/admin/pages/sale">Edit sale page text</AdminLinkButton>
          </div>
        </Card>
      </div>
    </>
  );
}
