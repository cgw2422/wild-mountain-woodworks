import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import { PageHeader } from "@/components/admin/ui";
import { createCategory } from "../actions";
import { CategoryForm } from "../CategoryForm";

export const metadata: Metadata = { title: "New category" };

export default async function NewCategoryPage() {
  await requireAdmin();
  return (
    <div className="max-w-3xl">
      <PageHeader title="New category" breadcrumbs={[{ label: "Categories", href: "/admin/categories" }, { label: "New" }]} />
      <CategoryForm
        mode="create"
        action={createCategory}
        values={{ name: "", slug: "", description: "", linkUrl: "", seoTitle: "", seoDescription: "", visible: true, showOnHomepage: false, image: null, archived: false }}
      />
    </div>
  );
}
