import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/admin/ui";
import { createProduct } from "../actions";
import { NewProductForm } from "./NewProductForm";

export const metadata: Metadata = { title: "New product" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  await requireAdmin();
  const categories = await prisma.category.findMany({
    where: { archivedAt: null },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
  return (
    <div className="max-w-2xl">
      <PageHeader title="New product" breadcrumbs={[{ label: "Products", href: "/admin/products" }, { label: "New" }]} />
      <NewProductForm action={createProduct} categories={categories} />
    </div>
  );
}
