import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import {requirePermission} from "@/lib/auth/session";
import { AdminLinkButton, PageHeader } from "@/components/admin/ui";
import { FaqManager } from "./FaqManager";

export const metadata: Metadata = { title: "FAQs" };

export default async function FaqsPage() {
  await requirePermission("content");
  const [categories, faqs] = await Promise.all([
    prisma.faqCategory.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }], include: { _count: { select: { faqs: true } } } }),
    prisma.faq.findMany({ orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] }),
  ]);
  return (
    <>
      <PageHeader
        title="FAQs"
        description="Questions and answers for the FAQ page. Mark any question “Show on product pages” to include it on every product."
        actions={
          <>
            <AdminLinkButton href="/admin/pages/faq">Edit FAQ page header</AdminLinkButton>
            <AdminLinkButton href="/faq" target="_blank">
              View FAQ page ↗
            </AdminLinkButton>
          </>
        }
      />
      <FaqManager
        categories={categories.map((c) => ({ id: c.id, name: c.name, count: c._count.faqs }))}
        faqs={faqs.map((f) => ({
          id: f.id,
          question: f.question,
          answer: f.answer,
          categoryId: f.categoryId,
          visible: f.visible,
          showOnProductPages: f.showOnProductPages,
          archived: Boolean(f.archivedAt),
        }))}
      />
    </>
  );
}
