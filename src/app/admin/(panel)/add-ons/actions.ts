"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { revalidateSite } from "@/lib/revalidate";
import { AdminError, adminAction, fd } from "@/lib/admin/action";
import { nextFreeName } from "@/lib/admin/names";
import { idList, intText, moneyText, optionalText, requiredText } from "../products/_lib/schemas";

const addOnSchema = z
  .object({
    name: requiredText(120, "Enter a name."),
    displayName: optionalText(120),
    description: optionalText(1000),
    price: moneyText({ required: true }),
    imageId: optionalText(64),
    scope: z.enum(["REUSABLE", "PRODUCT_SPECIFIC"]),
    required: z.boolean(),
    minQuantity: intText({ min: 0, max: 100 }),
    maxQuantity: intText({ min: 1, max: 100 }),
    quantityEnabled: z.boolean(),
    quantityStep: intText({ min: 1, max: 100 }),
    defaultQuantity: intText({ min: 1, max: 100 }),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.minQuantity != null && v.maxQuantity != null && v.minQuantity > v.maxQuantity) {
      ctx.addIssue({ code: "custom", path: ["minQuantity"], message: "Minimum can't be more than the maximum." });
    }
    const min = v.minQuantity ?? 0;
    const max = v.maxQuantity ?? 1;
    const step = v.quantityStep ?? 1;
    if (v.defaultQuantity != null && (v.defaultQuantity < Math.max(1, min) || v.defaultQuantity > max)) {
      ctx.addIssue({ code: "custom", path: ["defaultQuantity"], message: `Between ${Math.max(1, min)} and ${max}.` });
    } else if (v.defaultQuantity != null && step > 1 && (v.defaultQuantity - min) % step !== 0) {
      ctx.addIssue({ code: "custom", path: ["defaultQuantity"], message: `The minimum plus a multiple of the step (${step}).` });
    }
  });

function readAddOn(data: FormData) {
  const v = addOnSchema.parse({
    name: fd.str(data, "name"),
    displayName: fd.str(data, "displayName"),
    description: fd.str(data, "description"),
    price: fd.str(data, "price"),
    imageId: fd.str(data, "imageId"),
    scope: fd.str(data, "scope") || "REUSABLE",
    required: fd.bool(data, "required"),
    minQuantity: fd.str(data, "minQuantity"),
    maxQuantity: fd.str(data, "maxQuantity"),
    quantityEnabled: fd.bool(data, "quantityEnabled"),
    quantityStep: fd.str(data, "quantityStep"),
    defaultQuantity: fd.str(data, "defaultQuantity"),
    active: fd.bool(data, "active"),
  });
  return {
    name: v.name,
    displayName: v.displayName,
    description: v.description,
    priceCents: v.price ?? 0,
    imageId: v.imageId,
    scope: v.scope,
    required: v.required,
    minQuantity: v.minQuantity ?? 0,
    maxQuantity: v.maxQuantity ?? 1,
    quantityEnabled: v.quantityEnabled,
    quantityStep: v.quantityStep ?? 1,
    defaultQuantity: v.defaultQuantity,
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

/**
 * Copy an add-on as "Copy of …": price, image, description, quantity rules,
 * required/active flags and its configuration (the same option groups from
 * the shared library, with their order, labels, required overrides and
 * "sets the price per unit"). Product assignments are NOT copied, so nothing
 * changes on the site until the copy is assigned to a product. Saved quotes,
 * orders and invoices are untouched (they keep their own snapshots).
 */
export const duplicateAddOn = adminAction(async (admin, id: string) => {
  const src = await prisma.addOn.findUnique({ where: { id }, include: { optionGroups: { orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] } } });
  if (!src) throw new AdminError("That add-on no longer exists.");
  const similar = await prisma.addOn.findMany({ where: { name: { startsWith: `Copy of ${src.name}`.slice(0, 110), mode: "insensitive" } }, select: { name: true } });
  const name = nextFreeName(`Copy of ${src.name}`, similar.map((a) => a.name));
  const last = await prisma.addOn.aggregate({ _max: { displayOrder: true } });
  const copy = await prisma.addOn.create({
    data: {
      name,
      displayName: src.displayName,
      description: src.description,
      priceCents: src.priceCents,
      imageId: src.imageId,
      scope: src.scope,
      required: src.required,
      minQuantity: src.minQuantity,
      maxQuantity: src.maxQuantity,
      quantityEnabled: src.quantityEnabled,
      quantityStep: src.quantityStep,
      defaultQuantity: src.defaultQuantity,
      active: src.active,
      displayOrder: (last._max.displayOrder ?? -1) + 1,
      optionGroups: {
        create: src.optionGroups.map((g, i) => ({
          optionGroupId: g.optionGroupId,
          displayOrder: i,
          requiredOverride: g.requiredOverride,
          displayNameOverride: g.displayNameOverride,
          setsUnitPrice: g.setsUnitPrice,
        })),
      },
    },
  });
  await logActivity("addon.updated", `${admin.name} duplicated add-on "${src.name}" as "${copy.name}"`, { actorId: admin.id, entityType: "addOn", entityId: copy.id });
  revalidateSite();
  return { ok: true, id: copy.id, message: "Add-on duplicated." };
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

/* ------------------------------------------------------------------------ */
/* Configurable add-ons: the add-on's own option groups                      */
/* ------------------------------------------------------------------------ */

/** Attach a library option group (e.g. "Chair Style") to an add-on's own configuration. */
export const attachAddOnOptionGroup = adminAction(async (admin, addOnId: string, data: FormData) => {
  const optionGroupId = fd.str(data, "optionGroupId");
  if (!optionGroupId) throw new AdminError("Choose an option group.", { optionGroupId: "Choose an option group." });
  const [addOn, group] = await Promise.all([
    prisma.addOn.findUnique({ where: { id: addOnId }, select: { name: true } }),
    prisma.optionGroup.findUnique({ where: { id: optionGroupId }, select: { name: true } }),
  ]);
  if (!addOn || !group) throw new AdminError("That add-on or option group no longer exists.");
  if (await prisma.addOnOptionGroup.findUnique({ where: { addOnId_optionGroupId: { addOnId, optionGroupId } } })) {
    throw new AdminError("That group is already part of this add-on.", { optionGroupId: "Already attached." });
  }
  const last = await prisma.addOnOptionGroup.aggregate({ where: { addOnId }, _max: { displayOrder: true } });
  await prisma.addOnOptionGroup.create({ data: { addOnId, optionGroupId, displayOrder: (last._max.displayOrder ?? -1) + 1 } });
  await logActivity("addon.updated", `${admin.name} added option group "${group.name}" to add-on "${addOn.name}"`, { actorId: admin.id, entityType: "addOn", entityId: addOnId });
  revalidateSite();
  return { ok: true, message: `“${group.name}” added.` };
});

/** Per-add-on label and required override for an attached group. */
export const updateAddOnOptionGroup = adminAction(async (admin, addOnId: string, optionGroupId: string, data: FormData) => {
  const label = optionalText(120).parse(fd.str(data, "displayNameOverride"));
  const req = fd.str(data, "requiredOverride");
  const requiredOverride = req === "required" ? true : req === "optional" ? false : null;
  // "Sets the price per unit": the chosen value's price is the full unit price (e.g. X Back = $192.50 per chair). One group per add-on.
  const setsUnitPrice = fd.bool(data, "setsUnitPrice");
  const row = await prisma.$transaction(async (tx) => {
    if (setsUnitPrice) await tx.addOnOptionGroup.updateMany({ where: { addOnId, optionGroupId: { not: optionGroupId }, setsUnitPrice: true }, data: { setsUnitPrice: false } });
    return tx.addOnOptionGroup.update({
      where: { addOnId_optionGroupId: { addOnId, optionGroupId } },
      data: { displayNameOverride: label, requiredOverride, setsUnitPrice },
      include: { addOn: { select: { name: true } }, optionGroup: { select: { name: true } } },
    });
  });
  await logActivity(
    "addon.updated",
    `${admin.name} updated "${row.optionGroup.name}" on add-on "${row.addOn.name}"${setsUnitPrice ? " (sets the price per unit)" : ""}`,
    { actorId: admin.id, entityType: "addOn", entityId: addOnId },
  );
  revalidateSite();
  return { ok: true, message: "Saved." };
});

export const detachAddOnOptionGroup = adminAction(async (admin, addOnId: string, optionGroupId: string) => {
  const row = await prisma.addOnOptionGroup.delete({
    where: { addOnId_optionGroupId: { addOnId, optionGroupId } },
    include: { addOn: { select: { name: true } }, optionGroup: { select: { name: true } } },
  });
  await logActivity("addon.updated", `${admin.name} removed option group "${row.optionGroup.name}" from add-on "${row.addOn.name}"`, { actorId: admin.id, entityType: "addOn", entityId: addOnId });
  revalidateSite();
  return { ok: true, message: `“${row.optionGroup.name}” removed from this add-on. Saved quotes keep their configuration.` };
});

export const reorderAddOnOptionGroups = adminAction(async (admin, addOnId: string, ids: string[]) => {
  const list = idList.parse(ids);
  await prisma.$transaction(list.map((optionGroupId, i) => prisma.addOnOptionGroup.update({ where: { addOnId_optionGroupId: { addOnId, optionGroupId } }, data: { displayOrder: i } })));
  await logActivity("addon.updated", `${admin.name} reordered an add-on's option groups`, { actorId: admin.id, entityType: "addOn", entityId: addOnId });
  revalidateSite();
  return { ok: true, message: "Order saved." };
});
