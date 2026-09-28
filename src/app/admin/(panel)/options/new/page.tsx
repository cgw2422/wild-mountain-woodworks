import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/ui";
import { createOptionGroup } from "../actions";
import { OptionGroupForm } from "../OptionGroupForm";

export const metadata: Metadata = { title: "New option group" };

export default function NewOptionGroupPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="New option group" breadcrumbs={[{ label: "Options", href: "/admin/options" }, { label: "New" }]} />
      <OptionGroupForm
        mode="create"
        action={createOptionGroup}
        values={{ name: "", displayName: "", description: "", inputType: "BUTTONS", required: true, active: true }}
      />
    </div>
  );
}
