import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { EMAIL_TEMPLATES } from "@/lib/email/template-definitions";
import { Badge, PageHeader, formatDate, table } from "@/components/admin/ui";
import { EmailLogCard } from "@/components/admin/sales/EmailLogCard";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Email templates" };

export default async function EmailTemplatesPage() {
  await requirePermission("settings");
  const [stored, failed, recent] = await Promise.all([
    prisma.emailTemplate.findMany(),
    prisma.emailLog.findMany({ where: { status: "FAILED" }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.emailLog.findMany({ where: { status: { not: "FAILED" } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const byKey = new Map(stored.map((t) => [t.key, t]));
  const provider = process.env.EMAIL_PROVIDER;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Settings", href: "/admin/settings" }, { label: "Emails" }]}
        title="Email templates"
        description={`The emails customers and you receive for quotes, invoices, payments and orders. The logo, layout and button are added automatically.${provider ? "" : " Email delivery isn't configured yet, so emails are logged but not sent."}`}
      />
      <div className={table.wrap}>
        <table className={table.table}>
          <thead className={table.thead}>
            <tr>
              <th scope="col" className={table.th}>Email</th>
              <th scope="col" className={table.th}>Sent to</th>
              <th scope="col" className={table.th}>Subject</th>
              <th scope="col" className={table.th}>Status</th>
            </tr>
          </thead>
          <tbody className={table.tbody}>
            {EMAIL_TEMPLATES.map((d) => {
              const t = byKey.get(d.key);
              return (
                <tr key={d.key} className={table.tr}>
                  <td className={table.td}>
                    <Link href={`/admin/settings/emails/${d.key}`} className="inline-block py-1 font-medium hover:underline">
                      {t?.name ?? d.name}
                    </Link>
                    <p className="text-xs text-neutral-500">{d.description}</p>
                  </td>
                  <td className={table.td}>{d.audience === "customer" ? "Customer" : "You"}</td>
                  <td className={cn(table.td, "text-neutral-600")}>{t?.subject ?? d.subject}</td>
                  <td className={table.td}>{!t ? <Badge tone="amber">Not created — redeploy</Badge> : t.enabled ? <Badge tone="green">On</Badge> : <Badge tone="neutral">Off</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div id="log" className="mt-8 grid gap-6 lg:grid-cols-2">
        <EmailLogCard emails={failed} title="Failed emails" />
        <EmailLogCard emails={recent} title="Recently sent" />
      </div>
      <p className="mt-4 text-xs text-neutral-500">Last updated templates: {stored.length ? formatDate(stored.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b)).updatedAt, true) : "—"}</p>
    </>
  );
}
