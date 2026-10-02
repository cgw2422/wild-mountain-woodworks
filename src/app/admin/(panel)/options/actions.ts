"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { revalidateSite } from "@/lib/revalidate";
import { nextFreeName } from "@/lib/admin/names";
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

/**
 * Delete an option group from the library — also when products or
 * configurable add-ons use it: it is removed from them in the same
 * transaction (with its values, per-product settings and conditional price
 * rules), so it can't be chosen on new configurations. Saved quotes, orders
 * and invoices are untouched: they keep their own snapshot (names, choices,
 * quantities and prices) and never read the library.
 */
export const deleteOptionGroup = adminAction(async (admin, id: string) => {
  const group = await prisma.optionGroup.findUnique({ where: { id }, include: { _count: { select: { products: true, addOns: true, values: true } } } });
  if (!group) throw new AdminError("That option group no longer exists.");
  await prisma.$transaction([
    prisma.productOptionGroup.deleteMany({ where: { optionGroupId: id } }),
    prisma.addOnOptionGroup.deleteMany({ where: { optionGroupId: id } }),
    prisma.optionGroup.delete({ where: { id } }),
  ]);
  const { products, addOns, values } = group._count;
  const usage = [products ? `removed from ${products} product${products === 1 ? "" : "s"}` : "", addOns ? `${addOns} add-on${addOns === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
  await logActivity("option.updated", `${admin.name} deleted option group "${group.name}" (${values} value${values === 1 ? "" : "s"}${usage ? `; ${usage}` : ""})`, {
    actorId: admin.id,
    entityType: "optionGroup",
    entityId: id,
  });
  revalidateSite();
  return { ok: true, message: `“${group.name}” deleted${usage ? ` and ${usage}` : ""}. Saved quotes, orders and invoices keep their configuration.` };
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
const MAX_PRICE_RULES = 100;
const ruleMoney = moneyText({ required: true, allowNegative: true });

/**
 * Conditional pricing rules from the value form (JSON in `priceRules`, in
 * order): each is "while <value of another group> is selected, this value
 * costs <amount>". Returns null when the form didn't send the field (leave
 * the rules alone). Throws field errors for anything invalid — a rule must
 * depend on an existing value of a DIFFERENT group, at most once.
 */
async function readPriceRules(data: FormData, groupId: string) {
  if (!data.has("priceRules")) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fd.str(data, "priceRules") || "[]");
  } catch {
    throw new AdminError("The conditional pricing rules couldn't be read. Reload the page and try again.", { priceRules: "Couldn't read the rules." });
  }
  const parsed = z
    .array(z.object({ dependsOnValueId: z.string().trim().max(64), price: z.string().max(40) }))
    .max(MAX_PRICE_RULES, `At most ${MAX_PRICE_RULES} rules per value.`)
    .safeParse(raw);
  if (!parsed.success) throw new AdminError("Check the conditional pricing rules.", { priceRules: parsed.error.issues[0]?.message ?? "Invalid rules." });
  const rules = parsed.data;
  const fail = (i: number, message: string) => {
    throw new AdminError(`Conditional pricing rule ${i + 1}: ${message}`, { priceRules: `Rule ${i + 1}: ${message}` });
  };
  const ids = rules.map((r) => r.dependsOnValueId).filter(Boolean);
  const targets = new Map(
    (await prisma.optionValue.findMany({ where: { id: { in: ids } }, select: { id: true, groupId: true } })).map((v) => [v.id, v]),
  );
  const seen = new Set<string>();
  return rules.map((r, i) => {
    if (!r.dependsOnValueId) fail(i, "choose the option and value it depends on.");
    const target = targets.get(r.dependsOnValueId);
    if (!target) fail(i, "that value no longer exists.");
    if (target!.groupId === groupId) fail(i, "a value can't depend on another value of its own option.");
    if (seen.has(r.dependsOnValueId)) fail(i, "there's already a rule for that value.");
    seen.add(r.dependsOnValueId);
    const price = ruleMoney.safeParse(r.price);
    if (!price.success || price.data == null) fail(i, price.success ? "enter a price adjustment." : (price.error.issues[0]?.message ?? "enter a price adjustment."));
    return { dependsOnValueId: r.dependsOnValueId, priceModifierCents: (price as { data: number }).data, displayOrder: i };
  });
}

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

  const priceRules = await readPriceRules(data, groupId);
  const { priceModifier, ...rest } = input;
  const payload = { ...rest, priceModifierCents: priceModifier ?? 0, ...quantity };
  const group = await prisma.optionGroup.findUnique({ where: { id: groupId }, select: { name: true } });
  if (!group) throw new AdminError("That option group no longer exists.");

  const id = await prisma.$transaction(async (tx) => {
    let saved: string;
    if (valueId) {
      saved = (await tx.optionValue.update({ where: { id: valueId, groupId }, data: payload, select: { id: true } })).id;
    } else {
      const last = await tx.optionValue.aggregate({ where: { groupId }, _max: { displayOrder: true } });
      saved = (await tx.optionValue.create({ data: { ...payload, groupId, displayOrder: (last._max.displayOrder ?? -1) + 1 }, select: { id: true } })).id;
    }
    // Rules are configuration (saved quotes keep their own prices), so they're replaced as a set.
    if (priceRules) {
      await tx.optionValuePriceRule.deleteMany({ where: { optionValueId: saved } });
      if (priceRules.length) await tx.optionValuePriceRule.createMany({ data: priceRules.map((r) => ({ ...r, optionValueId: saved })) });
    }
    return saved;
  });
  const ruleNote = priceRules?.length ? ` with ${priceRules.length} conditional price${priceRules.length === 1 ? "" : "s"}` : "";
  await logActivity("option.updated", `${admin.name} ${valueId ? "updated" : "added"} value "${input.displayName}" in "${group.name}"${ruleNote}`, {
    actorId: admin.id,
    entityType: "optionGroup",
    entityId: groupId,
  });
  revalidateSite();
  return { ok: true, id: id ?? undefined, message: valueId ? "Value saved." : "Value added." };
});

/**
 * Delete one value from a library group (e.g. Walnut from Table Top Wood,
 * or a chair style from an add-on's Chair Style group). It disappears from
 * every product and add-on that uses the group, with its per-product
 * settings and any conditional price rules on or depending on it. Saved
 * quotes, orders and invoices keep their snapshot.
 */
export const deleteOptionValue = adminAction(async (admin, groupId: string, valueId: string) => {
  const value = await prisma.optionValue.findFirst({ where: { id: valueId, groupId }, include: { group: { select: { name: true, _count: { select: { products: true, addOns: true } } } } } });
  if (!value) throw new AdminError("That value no longer exists.");
  await prisma.optionValue.delete({ where: { id: valueId } });
  const { products, addOns } = value.group._count;
  const usage = [products ? `${products} product${products === 1 ? "" : "s"}` : "", addOns ? `${addOns} add-on${addOns === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
  await logActivity("option.updated", `${admin.name} deleted value "${value.displayName}" from "${value.group.name}"${usage ? ` (group used by ${usage})` : ""}`, {
    actorId: admin.id,
    entityType: "optionGroup",
    entityId: groupId,
  });
  revalidateSite();
  return { ok: true, message: `“${value.displayName}” deleted. Saved quotes, orders and invoices keep their configuration.` };
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

/**
 * Copy a group and all of its values (prices, images, swatches, custom and
 * active flags, order) as a new group. The copy isn't attached to any
 * product, so nothing changes on the public site until you attach it.
 */
export const duplicateOptionGroup = adminAction(async (admin, id: string) => {
  const src = await prisma.optionGroup.findUnique({ where: { id }, include: { values: { orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }], include: { priceRules: true } } } });
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
          priceRules: { create: v.priceRules.map((r) => ({ dependsOnValueId: r.dependsOnValueId, priceModifierCents: r.priceModifierCents, displayOrder: r.displayOrder })) },
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
  const src = await prisma.optionValue.findFirst({ where: { id: valueId, groupId }, include: { group: { select: { name: true } }, priceRules: true } });
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
        priceRules: { create: src.priceRules.map((r) => ({ dependsOnValueId: r.dependsOnValueId, priceModifierCents: r.priceModifierCents, displayOrder: r.displayOrder })) },
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
