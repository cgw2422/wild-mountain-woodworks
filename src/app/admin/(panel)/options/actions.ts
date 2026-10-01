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

const wholeNumber = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, `${label}: enter a whole number from 0 to 999.`)
    .transform(Number);

/** Quantity-based value settings (e.g. chairs: 0–8, step 1, default 0). Checked together so the range always makes sense. */
const quantitySchema = z
  .object({ min: wholeNumber("Minimum"), max: wholeNumber("Maximum"), step: wholeNumber("Step"), default: wholeNumber("Default") })
  .superRefine((q, ctx) => {
    if (q.max < q.min) ctx.addIssue({ code: "custom", path: ["max"], message: "The maximum can't be less than the minimum." });
    if (q.max < 1) ctx.addIssue({ code: "custom", path: ["max"], message: "The maximum must be at least 1." });
    if (q.step < 1) ctx.addIssue({ code: "custom", path: ["step"], message: "The step must be at least 1." });
    if (q.default < q.min || q.default > q.max) ctx.addIssue({ code: "custom", path: ["default"], message: "The default must be between the minimum and maximum." });
    else if (q.step >= 1 && (q.default - q.min) % q.step !== 0) ctx.addIssue({ code: "custom", path: ["default"], message: `The default must be the minimum plus a multiple of the step (${q.step}).` });
  });

const QUANTITY_FIELDS = { min: "quantityMin", max: "quantityMax", step: "quantityStep", default: "quantityDefault" } as const;

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

  // Quantity-based: the price is per unit and the customer picks how many.
  const quantityEnabled = fd.bool(data, "quantityEnabled");
  let quantity = { quantityEnabled: false } as { quantityEnabled: boolean; quantityMin?: number; quantityMax?: number; quantityStep?: number; quantityDefault?: number };
  if (quantityEnabled) {
    const parsed = quantitySchema.safeParse({ min: fd.str(data, "quantityMin") || "0", max: fd.str(data, "quantityMax"), step: fd.str(data, "quantityStep") || "1", default: fd.str(data, "quantityDefault") || "0" });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[QUANTITY_FIELDS[issue.path[0] as keyof typeof QUANTITY_FIELDS]] ??= issue.message;
      throw new AdminError("Check the quantity settings.", fieldErrors);
    }
    const q = parsed.data;
    quantity = { quantityEnabled: true, quantityMin: q.min, quantityMax: q.max, quantityStep: q.step, quantityDefault: q.default };
  }

  const { priceModifier, ...rest } = input;
  const payload = { ...rest, priceModifierCents: priceModifier ?? 0, ...quantity };
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

/* ------------------------------------------------------------------------ */
/* Duplicating                                                               */
/* ------------------------------------------------------------------------ */

/** First of "base", "base (2)", "base (3)"… that `taken` doesn't contain (case-insensitive). */
function nextFreeName(base: string, taken: string[]) {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  const trimmed = base.slice(0, 110);
  if (!used.has(trimmed.toLowerCase())) return trimmed;
  for (let i = 2; ; i++) {
    const candidate = `${trimmed} (${i})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Copy a group and all of its values (prices, images, swatches, custom and
 * active flags, order) as a new group. The copy isn't attached to any
 * product, so nothing changes on the public site until you attach it.
 */
export const duplicateOptionGroup = adminAction(async (admin, id: string) => {
  const src = await prisma.optionGroup.findUnique({ where: { id }, include: { values: { orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] } } });
  if (!src) throw new AdminError("That option group no longer exists.");
  const similar = await prisma.optionGroup.findMany({ where: { name: { startsWith: `Copy of ${src.name}`.slice(0, 110), mode: "insensitive" } }, select: { name: true } });
  const name = nextFreeName(`Copy of ${src.name}`, similar.map((g) => g.name));
  const last = await prisma.optionGroup.aggregate({ _max: { displayOrder: true } });
  const copy = await prisma.optionGroup.create({
    data: {
      name,
      displayName: src.displayName,
      description: src.description,
      inputType: src.inputType,
      required: src.required,
      active: src.active,
      displayOrder: (last._max.displayOrder ?? -1) + 1,
      values: {
        create: src.values.map((v, i) => ({
          name: v.name,
          displayName: v.displayName,
          description: v.description,
          imageId: v.imageId,
          swatchColor: v.swatchColor,
          priceModifierCents: v.priceModifierCents,
          isCustom: v.isCustom,
          quantityEnabled: v.quantityEnabled,
          quantityMin: v.quantityMin,
          quantityMax: v.quantityMax,
          quantityStep: v.quantityStep,
          quantityDefault: v.quantityDefault,
          active: v.active,
          displayOrder: i,
        })),
      },
    },
  });
  await logActivity("option.updated", `${admin.name} duplicated option group "${src.name}" as "${copy.name}"`, { actorId: admin.id, entityType: "optionGroup", entityId: copy.id });
  revalidateSite();
  return { ok: true, id: copy.id, message: "Option group duplicated." };
});

/**
 * Copy one value within its group, placed directly after the original. The
 * copy starts inactive: the group may already be live on products, and an
 * identical second choice shouldn't appear there before it's edited.
 */
export const duplicateOptionValue = adminAction(async (admin, groupId: string, valueId: string) => {
  const src = await prisma.optionValue.findFirst({ where: { id: valueId, groupId }, include: { group: { select: { name: true } } } });
  if (!src) throw new AdminError("That value no longer exists.");
  const siblings = await prisma.optionValue.findMany({ where: { groupId }, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } });
  const name = nextFreeName(`${src.name} (copy)`, siblings.map((s) => s.name));
  const copy = await prisma.$transaction(async (tx) => {
    const created = await tx.optionValue.create({
      data: {
        groupId,
        name,
        displayName: src.displayName,
        description: src.description,
        imageId: src.imageId,
        swatchColor: src.swatchColor,
        priceModifierCents: src.priceModifierCents,
        isCustom: src.isCustom,
        quantityEnabled: src.quantityEnabled,
        quantityMin: src.quantityMin,
        quantityMax: src.quantityMax,
        quantityStep: src.quantityStep,
        quantityDefault: src.quantityDefault,
        active: false,
      },
    });
    // Renumber so the copy sits right after the original.
    const order = siblings.flatMap((s) => (s.id === src.id ? [s.id, created.id] : [s.id]));
    for (const [i, id] of order.entries()) await tx.optionValue.update({ where: { id }, data: { displayOrder: i } });
    return created;
  });
  await logActivity("option.updated", `${admin.name} duplicated value "${src.displayName}" in "${src.group.name}"`, { actorId: admin.id, entityType: "optionGroup", entityId: groupId });
  revalidateSite();
  return { ok: true, id: copy.id, message: `Duplicated as “${name}” (inactive). Edit it, then switch it to Active.` };
});
