import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { Card, PageHeader } from "@/components/admin/ui";
import { NewPageForm } from "@/components/admin/pages/NewPageForm";

export const metadata: Metadata = { title: "Create page" };

export default async function NewPage() {
  await requirePermission("content");
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Pages", href: "/admin/pages" }, { label: "Create page" }]}
        title="Create page"
        description="New pages start as drafts — only signed-in staff can preview them until you publish."
      />
      <Card>
        <NewPageForm />
      </Card>
    </>
  );
}
