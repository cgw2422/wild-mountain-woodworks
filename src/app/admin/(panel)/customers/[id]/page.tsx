import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { ActionForm, Select, SubmitButton, TextArea, TextInput } from "@/components/admin/forms";
import { Card, PageHeader, adminButton, formatDate } from "@/components/admin/ui";
import { NotesPanel } from "@/components/admin/inbox/NotesPanel";
import { Money } from "@/components/admin/sales/Money";
import { SalesBadge } from "@/components/admin/sales/SalesBadge";
import { Timeline } from "@/components/admin/sales/Timeline";
import { EmailLogCard } from "@/components/admin/sales/EmailLogCard";
import { addNoteAction } from "../../inbox-actions";
import { logCommunicationAction, updateCustomerAction } from "../../sales-actions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const c = await prisma.customer.findUnique({ where: { id }, select: { name: true } });
  return { title: c ? c.name : "Customer not found" };
}

export default async function CustomerDetailPage({ params }: Props) {
  const { id } = await params;
  const admin = await requirePermission("sales");
  const finance = can(admin.role, "finance");
  const c = await prisma.customer.findUnique({
    where: { id },
    include: {
      quotes: { orderBy: { createdAt: "desc" }, select: { id: true, number: true, reference: true, status: true, productName: true, createdAt: true, currentRevision: { select: { totalCents: true } } } },
      orders: { orderBy: { createdAt: "desc" }, select: { id: true, number: true, productionStatus: true, paymentStatus: true, totalCents: true, createdAt: true } },
      invoices: { orderBy: { createdAt: "desc" }, select: { id: true, number: true, status: true, totalCents: true, amountPaidCents: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 100 },
      notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      emails: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!c) notFound();
  const lifetime = c.invoices.reduce((s, i) => s + (["VOID", "CANCELED"].includes(i.status) ? 0 : i.amountPaidCents), 0);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Customers", href: "/admin/customers" }, { label: c.name }]}
        title={c.name}
        description={`Customer since ${formatDate(c.createdAt)} · ${c.quotes.length} quote(s) · ${c.orders.length} order(s)${finance ? ` · paid ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(lifetime / 100)}` : ""}`}
        actions={
          <>
            <a href={`mailto:${c.email}`} className={adminButton.secondary}>
              Email
            </a>
            {finance ? (
              <Link href={`/admin/invoices/new?customer=${c.id}`} className={adminButton.secondary}>
                New invoice
              </Link>
            ) : null}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card title="Quotes" bodyClassName="p-0">
            {c.quotes.length ? (
              <ul className="divide-y divide-neutral-100">
                {c.quotes.map((q) => (
                  <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span>
                      <Link href={`/admin/quotes/${q.id}`} className="inline-block py-1.5 font-mono underline underline-offset-2">
                        {q.number ?? q.reference}
                      </Link>{" "}
                      <span className="text-neutral-600">
                        {q.productName ?? "Quote"} · {formatDate(q.createdAt)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Money cents={q.currentRevision?.totalCents ?? null} />
                      <SalesBadge status={q.status} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-neutral-500">No quotes.</p>
            )}
          </Card>
          <Card title="Orders" bodyClassName="p-0">
            {c.orders.length ? (
              <ul className="divide-y divide-neutral-100">
                {c.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span>
                      <Link href={`/admin/orders/${o.id}`} className="inline-block py-1.5 font-mono underline underline-offset-2">
                        {o.number}
                      </Link>{" "}
                      <span className="text-neutral-600">{formatDate(o.createdAt)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Money cents={o.totalCents} />
                      <SalesBadge status={o.productionStatus} />
                      <SalesBadge status={o.paymentStatus} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-neutral-500">No orders.</p>
            )}
          </Card>
          {finance ? (
            <Card title="Invoices" bodyClassName="p-0">
              {c.invoices.length ? (
                <ul className="divide-y divide-neutral-100">
                  {c.invoices.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                      <Link href={`/admin/invoices/${i.id}`} className="inline-block py-1.5 font-mono underline underline-offset-2">
                        {i.number}
                      </Link>
                      <span className="flex items-center gap-2">
                        <Money cents={i.totalCents} />
                        <SalesBadge status={i.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-4 text-sm text-neutral-500">No invoices.</p>
              )}
            </Card>
          ) : null}
          <Card title="Timeline" description="Quotes, invoices, payments, production and logged conversations.">
            <ActionForm action={logCommunicationAction.bind(null, c.id)} className="mb-6 grid gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-[10rem_1fr_auto] sm:items-end" resetOnSuccess successMessage="Logged.">
              <Select
                label="Log a…"
                name="type"
                defaultValue="communication.call"
                options={[
                  { value: "communication.call", label: "Phone call" },
                  { value: "communication.email", label: "Email" },
                  { value: "communication.meeting", label: "Visit / meeting" },
                  { value: "communication.note", label: "Note" },
                ]}
              />
              <TextInput label="Summary" name="message" required maxLength={1000} placeholder="e.g. Called to confirm walnut; wants delivery after the 15th." />
              <SubmitButton>Add</SubmitButton>
            </ActionForm>
            <Timeline items={c.activities} />
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          <Card title="Details">
            <ActionForm action={updateCustomerAction.bind(null, c.id)} className="space-y-3">
              <TextInput label="Name" name="name" required defaultValue={c.name} maxLength={120} />
              <TextInput label="Email" name="email" type="email" required defaultValue={c.email} maxLength={254} />
              <TextInput label="Phone" name="phone" defaultValue={c.phone ?? ""} maxLength={30} />
              <TextInput label="ZIP code" name="zipCode" defaultValue={c.zipCode ?? ""} maxLength={10} />
              <TextArea label="Delivery address" name="deliveryAddress" rows={2} defaultValue={c.deliveryAddress ?? ""} maxLength={300} />
              <TextArea label="Billing address" name="billingAddress" rows={2} defaultValue={c.billingAddress ?? ""} maxLength={300} />
              <div className="flex justify-end">
                <SubmitButton>Save</SubmitButton>
              </div>
            </ActionForm>
          </Card>
          <NotesPanel notes={c.notes} currentAdminId={admin.id} addAction={addNoteAction.bind(null, "customer", c.id)} />
          <EmailLogCard emails={c.emails} />
        </div>
      </div>
    </>
  );
}
