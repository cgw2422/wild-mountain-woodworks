"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { revalidateSite } from "@/lib/revalidate";
import { AdminError, adminAction, fd } from "@/lib/admin/action";
import { idList, intText, moneyText, optionalText, requiredText } from "../products/_lib/schemas";

const addOnSchema = z
  .object({
    name: requiredText(120, "Enter a name."),
    description: optionalText(1000),
    price: moneyText({ required: true }),
    imageId: optionalText(64),
    scope: z.enum(["REUSABLE", "PRODUCT_SPECIFIC"]),
    required: z.boolean(),
    minQuantity: intText({ min: 0, max: 100 }),
    maxQuantity: intText({ min: 1, max: 100 }),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.minQuantity != null && v.maxQuantity != null && v.minQuantity > v.maxQuantity) {
      ctx.addIssue({ code: "custom", path: ["minQuantity"], message: "Minimum can't be more than the maximum." });
    }
  });

function readAddOn(data: FormData) {
  const v = addOnSchema.parse({
    name: fd.str(data, "name"),
    description: fd.str(data, "description"),
    price: fd.str(data, "price"),
    imageId: fd.str(data, "imageId"),
    scope: fd.str(data, "scope") || "REUSABLE",
    required: fd.bool(data, "required"),
    minQuantity: fd.str(data, "minQuantity"),
    maxQuantity: fd.str(data, "maxQuantity"),
    active: fd.bool(data, "active"),
  });
  return {
    name: v.name,
    description: v.description,
    priceCents: v.price ?? 0,
    imageId: v.imageId,
    scope: v.scope,
    required: v.required,
    minQuantity: v.minQuantity ?? 0,
    maxQuantity: v.maxQuantity ?? 1,
    active: v.active,
  };
}

export const createAddOn = adminAction(async (admin, data: FormData) => {
  const input = readAddOn(data);
  const last = await prisma.addOn.aggregate({ _max: { displayOrder: true } });
  const addOn = await prisma.addOn.create({ data: { ...input, displayOrder: (last._max.displayOrder ?? -1) + 1 } });
  await logActivity("addon.updated", `${admin.name} created add-on "${addOn.name}"`, { actorId: admin.id, entityType: "addOn", entityId: addOn.id });
  revalidateSite();
  return { ok: true, id: addOn.id, message: "Add-on created." };
});

export const updateAddOn = adminAction(async (admin, id: string, data: FormData) => {
  const input = readAddOn(data);
  const addOn = await prisma.addOn.update({ where: { id }, data: input });
  await logActivity("addon.updated", `${admin.name} updated add-on "${addOn.name}"`, { actorId: admin.id, entityType: "addOn", entityId: id });
  revalidateSite();
  return { ok: true, message: "Add-on saved." };
});

export const reorderAddOns = adminAction(async (admin, ids: string[]) => {
  const list = idList.parse(ids);
  await prisma.$transaction(list.map((id, i) => prisma.addOn.update({ where: { id }, data: { displayOrder: i } })));
  await logActivity("addon.updated", `${admin.name} reordered add-ons`, { actorId: admin.id, entityType: "addOn" });
  revalidateSite();
  return { ok: true, message: "Order saved." };
});

export const archiveAddOn = adminAction(async (admin, id: string) => {
  const a = await prisma.addOn.update({ where: { id }, data: { archivedAt: new Date() } });
  await logActivity("addon.updated", `${admin.name} archived add-on "${a.name}"`, { actorId: admin.id, entityType: "addOn", entityId: id });
  revalidateSite();
  return { ok: true, message: "Add-on archived. It's hidden from every product." };
});

export const restoreAddOn = adminAction(async (admin, id: string) => {
  const a = await prisma.addOn.update({ where: { id }, data: { archivedAt: null } });
  await logActivity("addon.updated", `${admin.name} restored add-on "${a.name}"`, { actorId: admin.id, entityType: "addOn", entityId: id });
  revalidateSite();
  return { ok: true, message: "Add-on restored." };
});

export const deleteAddOn = adminAction(async (admin, id: string) => {
  const a = await prisma.addOn.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
  if (!a) throw new AdminError("That add-on no longer exists.");
  if (a._count.products > 0) {
    throw new AdminError(`“${a.name}” is assigned to ${a._count.products} product${a._count.products === 1 ? "" : "s"}. Remove it from those products first, or archive it instead.`);
  }
  await prisma.addOn.delete({ where: { id } });
  await logActivity("addon.updated", `${admin.name} deleted add-on "${a.name}"`, { actorId: admin.id, entityType: "addOn", entityId: id });
  revalidateSite();
  return { ok: true, message: "Add-on deleted." };
});

/* ------------------------------------------------------------------------ */
/* Product assignments                                                       */
/* ------------------------------------------------------------------------ */

export const assignAddOnToProduct = adminAction(async (admin, addOnId: string, data: FormData) => {
  const productId = fd.str(data, "productId");
  if (!productId) throw new AdminError("Choose a product.", { productId: "Choose a product." });
  const priceOverride = moneyText().parse(fd.str(data, "priceOverride"));
  const [addOn, product] = await Promise.all([
    prisma.addOn.findUnique({ where: { id: addOnId }, select: { name: true } }),
    prisma.product.findUnique({ where: { id: productId }, select: { name: true } }),
  ]);
  if (!addOn || !product) throw new AdminError("That product or add-on no longer exists.");
  const last = await prisma.productAddOn.aggregate({ where: { productId }, _max: { displayOrder: true } });
  await prisma.productAddOn.create({
    data: { addOnId, productId, priceOverrideCents: priceOverride, displayOrder: (last._max.displayOrder ?? -1) + 1 },
  });
  await logActivity("addon.updated", `${admin.name} assigned add-on "${addOn.name}" to "${product.name}"`, { actorId: admin.id, entityType: "addOn", entityId: addOnId });
  revalidateSite();
  return { ok: true, message: `Assigned to ${product.name}.` };
});

export const updateAddOnAssignment = adminAction(async (admin, addOnId: string, productId: string, data: FormData) => {
  const priceOverride = moneyText().safeParse(fd.str(data, "priceOverride"));
  if (!priceOverride.success) throw new AdminError("Enter a valid price or leave it blank.", { priceOverride: priceOverride.error.issues[0]?.message ?? "Invalid amount." });
  const row = await prisma.productAddOn.update({
    where: { productId_addOnId: { productId, addOnId } },
    data: { priceOverrideCents: priceOverride.data, enabled: fd.bool(data, "enabled") },
    include: { product: { select: { name: true } }, addOn: { select: { name: true } } },
  });
  await logActivity("addon.updated", `${admin.name} updated "${row.addOn.name}" on "${row.product.name}"`, { actorId: admin.id, entityType: "addOn", entityId: addOnId });
  revalidateSite();
  return { ok: true, message: "Saved." };
});

export const removeAddOnFromProduct = adminAction(async (admin, addOnId: string, productId: string) => {
  const row = await prisma.productAddOn.delete({
    where: { productId_addOnId: { productId, addOnId } },
    include: { product: { select: { name: true } }, addOn: { select: { name: true } } },
  });
  await logActivity("addon.updated", `${admin.name} removed add-on "${row.addOn.name}" from "${row.product.name}"`, { actorId: admin.id, entityType: "addOn", entityId: addOnId });
  revalidateSite();
  return { ok: true, message: `Removed from ${row.product.name}.` };
});
