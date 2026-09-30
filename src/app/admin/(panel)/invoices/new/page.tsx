import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/admin/ui";
import { InvoiceEditor } from "@/components/admin/sales/InvoiceEditor";
import { blankLine } from "@/components/admin/sales/LineItemsEditor";
import { createCustomInvoiceAction } from "../../sales-actions";

export const metadata: Metadata = { title: "New invoice" };

/** A custom invoice (extra work, a change order…) for an existing customer. */
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ customer?: string; order?: string }> }) {
  await requirePermission("finance");
  const sp = await searchParams;
  const customer = sp.customer ? await prisma.customer.findUnique({ where: { id: sp.customer }, select: { id: true, name: true, email: true } }) : null;
  if (!customer) notFound();
  const order = sp.order ? await prisma.order.findFirst({ where: { id: sp.order, customerId: customer.id }, select: { id: true, number: true } }) : null;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Invoices", href: "/admin/invoices" }, { label: "New" }]}
        title="New custom invoice"
        description={`For ${customer.name} (${customer.email})${order ? `, order ${order.number}` : ""}. It's saved as a draft; send it from the next screen.`}
      />
      <InvoiceEditor
        action={createCustomInvoiceAction}
        extra={{ customerId: customer.id, orderId: order?.id ?? null }}
        showCustomer={false}
        submitLabel="Create draft invoice"
        redirectToId="/admin/invoices/"
        initial={{ customerName: customer.name, customerEmail: customer.email, dueOn: "", customerNotes: "", lines: [blankLine("CUSTOM")] }}
      />
    </>
  );
}
