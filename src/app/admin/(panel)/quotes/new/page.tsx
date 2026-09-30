import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { ActionForm, Select, SubmitButton, TextArea, TextInput } from "@/components/admin/forms";
import { Card, PageHeader } from "@/components/admin/ui";
import { createManualQuoteAction } from "../../sales-actions";

export const metadata: Metadata = { title: "New quote" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  await requirePermission("sales");
  await requirePermission("finance");
  const sp = await searchParams;
  const products = await prisma.product.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const preselected = products.some((p) => p.id === sp.product) ? sp.product : "";
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Quotes", href: "/admin/quotes" }, { label: "New" }]} title="New quote" description="For requests by phone, email or in person. You'll add line items and prices on the next screen." />
      <Card className="max-w-3xl">
        <ActionForm action={createManualQuoteAction} className="space-y-4" redirectToId="/admin/quotes/" successMessage={null}>
          <div className="grid gap-4 md:grid-cols-2">
            <TextInput label="Customer name" name="name" required maxLength={120} />
            <TextInput label="Email" name="email" type="email" required maxLength={254} help="Existing customers are matched by exact email." />
            <TextInput label="Phone" name="phone" maxLength={30} />
            <TextInput label="ZIP code" name="zipCode" maxLength={10} />
          </div>
          <TextInput label="Delivery address" name="address" maxLength={300} />
          <Select label="Start from a product (optional)" name="productId" defaultValue={preselected} placeholder="— None —" options={products.map((p) => ({ value: p.id, label: p.name }))} help="Adds the product at its current base price as the first line." />
          <TextArea label="Request notes" name="notes" rows={3} maxLength={4000} help="What the customer asked for. Internal." />
          <div className="flex justify-end border-t border-neutral-100 pt-4">
            <SubmitButton>Create quote</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
