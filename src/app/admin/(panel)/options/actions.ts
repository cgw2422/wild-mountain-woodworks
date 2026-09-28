"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { revalidateSite } from "@/lib/revalidate";
import { AdminError, adminAction, fd } from "@/lib/admin/action";
import { hexColorText, idList, moneyText, optionalText, requiredText } from "../products/_lib/schemas";

const groupSchema = z.object({
  name: requiredText(120, "Enter an internal name."),
  displayName: requiredText(120, "Enter the name customers see."),
  description: optionalText(1000),
  inputType: z.enum(["BUTTONS", "IMAGE", "SWATCH", "DROPDOWN", "RADIO"], { message: "Choose how the option is displayed." }),
  required: z.boolean(),
  active: z.boolean(),
});

function readGroup(data: FormData) {
  return groupSchema.parse({
    name: fd.str(data, "name"),
    displayName: fd.str(data, "displayName") || fd.str(data, "name"),
    description: fd.str(data, "description"),
    inputType: fd.str(data, "inputType"),
    required: fd.bool(data, "required"),
    active: fd.bool(data, "active"),
  });
}

async function assertGroupNameFree(name: string, excludeId?: string) {
  const hit = await prisma.optionGroup.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
  if (hit) throw new AdminError("Another option group already uses that internal name.", { name: "Already used by another option group." });
}

export const createOptionGroup = adminAction(async (admin, data: FormData) => {
  const input = readGroup(data);
  await assertGroupNameFree(input.name);
  const last = await prisma.optionGroup.aggregate({ _max: { displayOrder: true } });
  const group = await prisma.optionGroup.create({ data: { ...input, displayOrder: (last._max.displayOrder ?? -1) + 1 } });
  await logActivity("option.updated", `${admin.name} created option group "${group.name}"`, { actorId: admin.id, entityType: "optionGroup", entityId: group.id });
  revalidateSite();
  return { ok: true, id: group.id, message: "Option group created. Now add its values." };
});

export const updateOptionGroup = adminAction(async (admin, id: string, data: FormData) => {
  const input = readGroup(data);
  await assertGroupNameFree(input.name, id);
  const group = await prisma.optionGroup.update({ where: { id }, data: input });
  await logActivity("option.updated", `${admin.name} updated option group "${group.name}"`, { actorId: admin.id, entityType: "optionGroup", entityId: id });
  revalidateSite();
  return { ok: true, message: "Option group saved." };
});

export const reorderOptionGroups = adminAction(async (admin, ids: string[]) => {
  const list = idList.parse(ids);
  await prisma.$transaction(list.map((id, i) => prisma.optionGroup.update({ where: { id }, data: { displayOrder: i } })));
  await logActivity("option.updated", `${admin.name} reordered option groups`, { actorId: admin.id, entityType: "optionGroup" });
  revalidateSite();
  return { ok: true, message: "Order saved." };
});

export const setOptionGroupActive = adminAction(async (admin, id: string, active: boolean) => {
  const group = await prisma.optionGroup.update({ where: { id }, data: { active } });
  await logActivity("option.updated", `${admin.name} ${active ? "activated" : "deactivated"} option group "${group.name}"`, {
    actorId: admin.id,
    entityType: "optionGroup",
    entityId: id,
  });
  revalidateSite();
  return { ok: true, message: active ? "Option group activated." : "Option group deactivated. It is hidden from every product." };
});

export const deleteOptionGroup = adminAction(async (admin, id: string) => {
  const group = await prisma.optionGroup.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
  if (!group) throw new AdminError("That option group no longer exists.");
  if (group._count.products > 0) {
    throw new AdminError(
      `“${group.name}” is attached to ${group._count.products} product${group._count.products === 1 ? "" : "s"}. Detach it from those products first, or deactivate it instead.`,
    );
  }
  await prisma.optionGroup.delete({ where: { id } });
  await logActivity("option.updated", `${admin.name} deleted option group "${group.name}"`, { actorId: admin.id, entityType: "optionGroup", entityId: id });
  revalidateSite();
  return { ok: true, message: "Option group deleted." };
});

/* ------------------------------------------------------------------------ */
/* Values                                                                    */
/* ------------------------------------------------------------------------ */

const valueSchema = z.object({
  name: requiredText(120, "Enter an internal name."),
  displayName: requiredText(120, "Enter the name customers see."),
  description: optionalText(1000),
  imageId: optionalText(64),
  swatchColor: hexColorText,
  priceModifier: moneyText({ allowNegative: true }),
  isCustom: z.boolean(),
  active: z.boolean(),
});

/** Create (valueId null) or update a value in a group. */
export const saveOptionValue = adminAction(async (admin, groupId: string, valueId: string | null, data: FormData) => {
  const displayName = fd.str(data, "displayName");
  const input = valueSchema.parse({
    name: fd.str(data, "name") || displayName,
    displayName,
    description: fd.str(data, "description"),
    imageId: fd.str(data, "imageId"),
    swatchColor: fd.str(data, "swatchColor"),
    priceModifier: fd.str(data, "priceModifier"),
    isCustom: fd.bool(data, "isCustom"),
    active: fd.bool(data, "active"),
  });
  const clash = await prisma.optionValue.findFirst({
    where: { groupId, name: { equals: input.name, mode: "insensitive" }, ...(valueId ? { id: { not: valueId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new AdminError("Another value in this group already uses that internal name.", { name: "Already used in this group." });

  const { priceModifier, ...rest } = input;
  const payload = { ...rest, priceModifierCents: priceModifier ?? 0 };
  const group = await prisma.optionGroup.findUnique({ where: { id: groupId }, select: { name: true } });
  if (!group) throw new AdminError("That option group no longer exists.");

  let id = valueId;
  if (valueId) {
    await prisma.optionValue.update({ where: { id: valueId, groupId }, data: payload });
  } else {
    const last = await prisma.optionValue.aggregate({ where: { groupId }, _max: { displayOrder: true } });
    const created = await prisma.optionValue.create({ data: { ...payload, groupId, displayOrder: (last._max.displayOrder ?? -1) + 1 } });
    id = created.id;
  }
  await logActivity("option.updated", `${admin.name} ${valueId ? "updated" : "added"} value "${input.displayName}" in "${group.name}"`, {
    actorId: admin.id,
    entityType: "optionGroup",
    entityId: groupId,
  });
  revalidateSite();
  return { ok: true, id: id ?? undefined, message: valueId ? "Value saved." : "Value added." };
});

export const deleteOptionValue = adminAction(async (admin, groupId: string, valueId: string) => {
  const value = await prisma.optionValue.findFirst({ where: { id: valueId, groupId }, include: { group: { select: { name: true } } } });
  if (!value) throw new AdminError("That value no longer exists.");
  await prisma.optionValue.delete({ where: { id: valueId } });
  await logActivity("option.updated", `${admin.name} deleted value "${value.displayName}" from "${value.group.name}"`, {
    actorId: admin.id,
    entityType: "optionGroup",
    entityId: groupId,
  });
  revalidateSite();
  return { ok: true, message: "Value deleted." };
});

export const reorderOptionValues = adminAction(async (admin, groupId: string, ids: string[]) => {
  const list = idList.parse(ids);
  await prisma.$transaction(list.map((id, i) => prisma.optionValue.update({ where: { id, groupId }, data: { displayOrder: i } })));
  await logActivity("option.updated", `${admin.name} reordered option values`, { actorId: admin.id, entityType: "optionGroup", entityId: groupId });
  revalidateSite();
  return { ok: true, message: "Value order saved." };
});
