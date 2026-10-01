import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import { PageHeader } from "@/components/admin/ui";
import { createAddOn } from "../actions";
import { AddOnForm } from "../AddOnForm";

export const metadata: Metadata = { title: "New add-on" };

export default async function NewAddOnPage() {
  await requireAdmin();
  return (
    <div className="max-w-3xl">
      <PageHeader title="New add-on" breadcrumbs={[{ label: "Add-ons", href: "/admin/add-ons" }, { label: "New" }]} />
      <AddOnForm
        mode="create"
        action={createAddOn}
        values={{ name: "", displayName: "", description: "", price: "", image: null, scope: "REUSABLE", required: false, minQuantity: "0", maxQuantity: "1", quantityEnabled: true, quantityStep: "1", defaultQuantity: "", active: true }}
      />
    </div>
  );
}
