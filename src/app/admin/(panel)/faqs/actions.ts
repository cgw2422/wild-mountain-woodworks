"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { AdminError, adminAction, fd } from "@/lib/admin/action";
import { revalidateSite } from "@/lib/revalidate";
import { uniqueSlug } from "@/lib/slug";
import { reqText } from "@/components/admin/content/validation";

const ids = z.array(z.string().min(1).max(40)).max(1000);

/* Categories ---------------------------------------------------------------- */

export const createFaqCategory = adminAction(async (admin, data: FormData) => {
  const name = reqText(80, "Enter a category name.").parse(fd.str(data, "name"));
  const slug = await uniqueSlug(name, async (s) => Boolean(await prisma.faqCategory.findUnique({ where: { slug: s }, select: { id: true } })));
  const last = await prisma.faqCategory.aggregate({ _max: { displayOrder: true } });
  await prisma.faqCategory.create({ data: { name, slug, displayOrder: (last._max.displayOrder ?? -1) + 1 } });
  await logActivity("faq.updated", `${admin.name} added FAQ category “${name}”`, { actorId: admin.id, entityType: "faqCategory" });
  revalidateSite();
  return { ok: true, message: `Category “${name}” added.` };
});

export const renameFaqCategory = adminAction(async (admin, id: string, data: FormData) => {
  const name = reqText(80, "Enter a category name.").parse(fd.str(data, "name"));
  await prisma.faqCategory.update({ where: { id }, data: { name } });
  await logActivity("faq.updated", `${admin.name} renamed an FAQ category to “${name}”`, { actorId: admin.id, entityType: "faqCategory", entityId: id });
  revalidateSite();
  return { ok: true, message: "Category renamed." };
});

export const deleteFaqCategory = adminAction(async (admin, id: string) => {
  const cat = await prisma.faqCategory.findUnique({ where: { id }, select: { name: true } });
  if (!cat) throw new AdminError("This category was already deleted.");
  // FAQs are kept and become uncategorized (FK is ON DELETE SET NULL).
  await prisma.faqCategory.delete({ where: { id } });
  await logActivity("faq.updated", `${admin.name} deleted FAQ category “${cat.name}”`, { actorId: admin.id, entityType: "faqCategory", entityId: id });
  revalidateSite();
  return { ok: true, message: "Category deleted. Its questions are now uncategorized." };
});

export const reorderFaqCategories = adminAction(async (admin, raw: string[]) => {
  const list = ids.parse(raw);
  await prisma.$transaction(list.map((id, i) => prisma.faqCategory.update({ where: { id }, data: { displayOrder: i } })));
  await logActivity("faq.updated", `${admin.name} reordered FAQ categories`, { actorId: admin.id, entityType: "faqCategory" });
  revalidateSite();
  return { ok: true, message: "Order saved." };
});

/* FAQs ---------------------------------------------------------------------- */

const faqSchema = z.object({
  question: reqText(300, "Enter the question."),
  answer: reqText(10000, "Enter an answer."),
  categoryId: z
    .string()
    .max(40)
    .transform((v) => (v ? v : null)),
  visible: z.boolean(),
  showOnProductPages: z.boolean(),
});

export const saveFaq = adminAction(async (admin, id: string | null, data: FormData) => {
  const parsed = faqSchema.parse({
    question: fd.str(data, "question"),
    answer: typeof data.get("answer") === "string" ? String(data.get("answer")).trim() : "",
    categoryId: fd.str(data, "categoryId"),
    visible: fd.bool(data, "visible"),
    showOnProductPages: fd.bool(data, "showOnProductPages"),
  });
  if (parsed.categoryId && !(await prisma.faqCategory.findUnique({ where: { id: parsed.categoryId }, select: { id: true } }))) {
    throw new AdminError("That category was deleted. Choose another.", { categoryId: "Choose another category." });
  }
  const endOf = async (categoryId: string | null) =>
    ((await prisma.faq.aggregate({ where: { categoryId }, _max: { displayOrder: true } }))._max.displayOrder ?? -1) + 1;

  if (id) {
    const existing = await prisma.faq.findUnique({ where: { id }, select: { categoryId: true } });
    if (!existing) throw new AdminError("This question no longer exists.");
    const moved = existing.categoryId !== parsed.categoryId;
    await prisma.faq.update({ where: { id }, data: { ...parsed, ...(moved ? { displayOrder: await endOf(parsed.categoryId) } : {}) } });
    await logActivity("faq.updated", `${admin.name} updated FAQ “${parsed.question}”`, { actorId: admin.id, entityType: "faq", entityId: id });
  } else {
    const faq = await prisma.faq.create({ data: { ...parsed, displayOrder: await endOf(parsed.categoryId) } });
    await logActivity("faq.created", `${admin.name} added FAQ “${parsed.question}”`, { actorId: admin.id, entityType: "faq", entityId: faq.id });
  }
  revalidateSite();
  return { ok: true, message: id ? "Question saved." : "Question added." };
});

export const reorderFaqs = adminAction(async (admin, raw: string[]) => {
  const list = ids.parse(raw);
  await prisma.$transaction(list.map((id, i) => prisma.faq.update({ where: { id }, data: { displayOrder: i } })));
  await logActivity("faq.updated", `${admin.name} reordered FAQs`, { actorId: admin.id, entityType: "faq" });
  revalidateSite();
  return { ok: true, message: "Order saved." };
});

export const setFaqArchived = adminAction(async (admin, id: string, archived: boolean) => {
  const faq = await prisma.faq.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
  await logActivity("faq.updated", `${admin.name} ${archived ? "archived" : "restored"} FAQ “${faq.question}”`, { actorId: admin.id, entityType: "faq", entityId: id });
  revalidateSite();
  return { ok: true, message: archived ? "Question archived — hidden from the site." : "Question restored." };
});

export const deleteFaq = adminAction(async (admin, id: string) => {
  const faq = await prisma.faq.findUnique({ where: { id }, select: { question: true } });
  if (!faq) throw new AdminError("This question was already deleted.");
  await prisma.faq.delete({ where: { id } });
  await logActivity("faq.deleted", `${admin.name} deleted FAQ “${faq.question}”`, { actorId: admin.id, entityType: "faq", entityId: id });
  revalidateSite();
  return { ok: true, message: "Question deleted." };
});
