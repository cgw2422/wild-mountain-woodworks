"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { AdminError, adminAction, fd } from "@/lib/admin/action";
import { salePriceFor } from "@/lib/pricing/sale";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { computeEstimate, fmtPct, type EstimateInputs } from "@/lib/pricing/estimator";
import { estimateInputsSchema, estimateMetaSchema } from "@/lib/pricing/estimate-schema";
import { pricingThresholds } from "@/lib/pricing/defaults";
import { getSettings } from "@/lib/settings";
import { revalidateSite } from "@/lib/revalidate";
import { createManualQuote } from "@/lib/sales/quotes";

/**
 * Internal pricing calculator actions. Estimates are decision support only:
 * nothing here publishes a price or changes a product unless the admin
 * explicitly chooses "Update product pricing".
 */

function parseInputs(raw: string): EstimateInputs {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new AdminError("The calculator data couldn't be read. Please try again.");
  }
  const parsed = estimateInputsSchema.safeParse(json);
  if (!parsed.success) throw new AdminError("Some calculator values are out of range. Check the highlighted numbers and try again.");
  return parsed.data;
}

function readMeta(data: FormData) {
  return estimateMetaSchema.parse({
    name: fd.str(data, "name"),
    customerName: fd.str(data, "customerName"),
    customerEmail: fd.str(data, "customerEmail"),
    customerPhone: fd.str(data, "customerPhone"),
    customerZip: fd.str(data, "customerZip"),
    productId: fd.str(data, "productId"),
    notes: fd.str(data, "notes"),
  });
}

async function resultsFor(inputs: EstimateInputs) {
  const settings = await getSettings();
  const r = computeEstimate(inputs, pricingThresholds(settings));
  return {
    productType: inputs.productType || null,
    dimensions: inputs.dimensions || null,
    woodSpecies: inputs.woodSpecies || null,
    materialCostCents: r.materialCostCents,
    suppliesCostCents: r.suppliesCostCents,
    otherDirectCostCents: r.otherDirectCostCents,
    laborHours: r.laborHours,
    laborCostCents: r.laborCostCents,
    overheadCostCents: r.overheadCostCents,
    totalCostCents: r.totalCostCents,
    targetMarginPct: inputs.targetMarginPct,
    floorCents: r.pricing.floorCents,
    detailedPriceCents: r.pricing.detailedPriceCents,
    baseRecommendedCents: r.pricing.baseRecommendedCents,
    valueAdjustmentCents: r.pricing.valueAdjustmentCents,
    finalRecommendedCents: r.pricing.finalRecommendedCents,
    fiftyCheckCents: r.pricing.fiftyCheckCents,
    finalPriceCents: r.finalPriceCents,
    manualPrice: r.manualPrice,
    depositPct: r.deposit.pct,
    depositCents: r.deposit.depositCents,
    balanceCents: r.deposit.balanceCents,
    grossProfitCents: r.profit.grossProfitCents,
    grossMarginPct: r.profit.grossMarginPct,
    netProfitCents: r.profit.netProfitCents,
  };
}

function refresh(id?: string) {
  revalidatePath("/admin/pricing-calculator");
  if (id) revalidatePath(`/admin/pricing-calculator/${id}`);
}

/** Create (id = null) or update an estimate. Results are recalculated here. */
export const saveEstimate = adminAction(async (admin, estimateId: string | null, data: FormData) => {
  const meta = readMeta(data);
  const inputs = parseInputs(fd.str(data, "inputs"));
  if (meta.productId && !(await prisma.product.findUnique({ where: { id: meta.productId }, select: { id: true } }))) {
    throw new AdminError("That product no longer exists.", { productId: "Choose another product." });
  }
  const payload = { ...meta, inputs: inputs as unknown as Prisma.InputJsonValue, ...(await resultsFor(inputs)) };
  const saved = estimateId
    ? await prisma.priceEstimate.update({ where: { id: estimateId }, data: payload })
    : await prisma.priceEstimate.create({ data: { ...payload, createdById: admin.id } });
  await logActivity("estimate.saved", `${admin.name} saved price estimate "${saved.name}"`, { actorId: admin.id, entityType: "estimate", entityId: saved.id });
  refresh(saved.id);
  return { ok: true, id: saved.id, message: "Estimate saved." };
});

export const duplicateEstimate = adminAction(async (admin, estimateId: string) => {
  const src = await prisma.priceEstimate.findUnique({ where: { id: estimateId } });
  if (!src) throw new AdminError("That estimate no longer exists.");
  const copy = await prisma.priceEstimate.create({
    data: {
      name: `Copy of ${src.name}`.slice(0, 160),
      customerName: src.customerName,
      customerEmail: src.customerEmail,
      customerPhone: src.customerPhone,
      customerZip: src.customerZip,
      productId: src.productId,
      inputs: src.inputs as Prisma.InputJsonValue,
      productType: src.productType,
      dimensions: src.dimensions,
      woodSpecies: src.woodSpecies,
      materialCostCents: src.materialCostCents,
      suppliesCostCents: src.suppliesCostCents,
      otherDirectCostCents: src.otherDirectCostCents,
      laborHours: src.laborHours,
      laborCostCents: src.laborCostCents,
      overheadCostCents: src.overheadCostCents,
      totalCostCents: src.totalCostCents,
      targetMarginPct: src.targetMarginPct,
      floorCents: src.floorCents,
      detailedPriceCents: src.detailedPriceCents,
      baseRecommendedCents: src.baseRecommendedCents,
      valueAdjustmentCents: src.valueAdjustmentCents,
      finalRecommendedCents: src.finalRecommendedCents,
      fiftyCheckCents: src.fiftyCheckCents,
      finalPriceCents: src.finalPriceCents,
      manualPrice: src.manualPrice,
      depositPct: src.depositPct,
      depositCents: src.depositCents,
      balanceCents: src.balanceCents,
      grossProfitCents: src.grossProfitCents,
      grossMarginPct: src.grossMarginPct,
      netProfitCents: src.netProfitCents,
      notes: src.notes,
      createdById: admin.id,
    },
  });
  await logActivity("estimate.saved", `${admin.name} duplicated estimate "${src.name}"`, { actorId: admin.id, entityType: "estimate", entityId: copy.id });
  refresh();
  return { ok: true, id: copy.id, message: "Estimate duplicated." };
});

export const setEstimateArchived = adminAction(async (admin, estimateId: string, archived: boolean) => {
  const e = await prisma.priceEstimate.update({ where: { id: estimateId }, data: { archivedAt: archived ? new Date() : null } });
  await logActivity("estimate.archived", `${admin.name} ${archived ? "archived" : "restored"} estimate "${e.name}"`, {
    actorId: admin.id,
    entityType: "estimate",
    entityId: e.id,
  });
  refresh(e.id);
  return { ok: true, message: archived ? "Estimate archived." : "Estimate restored." };
});

type EstimateRow = Prisma.PriceEstimateGetPayload<object>;

/** Internal note only — customers never see costs, margins or formulas. */
function estimateSummary(e: EstimateRow, price: number) {
  return [
    `Price estimate "${e.name}".`,
    [e.productType, e.woodSpecies, e.dimensions].filter(Boolean).join(" · "),
    `Quoted price: ${formatCents(price)}${e.manualPrice ? " (manual price)" : " (recommended price)"}`,
    `30% pricing floor ${formatCents(e.floorCents)} · Detailed price ${e.detailedPriceCents != null ? formatCents(e.detailedPriceCents) : "—"} · Base recommended ${formatCents(e.baseRecommendedCents)}${e.valueAdjustmentCents ? ` · Value adjustments +${formatCents(e.valueAdjustmentCents)}` : ""}`,
    price < e.floorCents ? "WARNING: This price is below the 30% material-cost pricing floor." : "",
    `Materials ${formatCents(e.materialCostCents)} (${fmtPct((e.materialCostCents / price) * 100)} of sale) · Labor ${formatCents(e.laborCostCents)} · Other direct ${formatCents(e.otherDirectCostCents)} · Overhead ${formatCents(e.overheadCostCents)}`,
    `Gross profit ${formatCents(e.grossProfitCents)} (${fmtPct(e.grossMarginPct)} gross margin) · Net after overhead ${formatCents(e.netProfitCents)}`,
    `Deposit ${fmtPct(e.depositPct)}: ${formatCents(e.depositCents)} · Balance ${formatCents(e.balanceCents)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const convertSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer's name.").max(120),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address.")),
  phone: z.string().trim().max(30).transform((v) => v || null),
  zipCode: z.string().trim().max(10),
});

/**
 * "Create quote from estimate": a new DRAFT quote with one line at the
 * estimate's selling price and its deposit percentage. The cost breakdown is
 * recorded as an internal note — customers never see costs or margins.
 */
export const convertEstimateToQuote = adminAction(async (admin, estimateId: string, data: FormData) => {
  const e = await prisma.priceEstimate.findUnique({ where: { id: estimateId }, include: { product: { select: { id: true, name: true } } } });
  if (!e) throw new AdminError("That estimate no longer exists.");
  if (e.quoteRequestId) throw new AdminError("This estimate has already been converted into a quote.");
  const price = e.finalPriceCents;
  if (!price) throw new AdminError("Save the estimate with a selling price first.");
  const c = convertSchema.parse({ name: fd.str(data, "name"), email: fd.str(data, "email"), phone: fd.str(data, "phone"), zipCode: fd.str(data, "zipCode") });

  const summary = estimateSummary(e, price);

  // The customer-facing line is just the piece and its price; costs,
  // margins and formulas stay in the internal note.
  const description = e.product?.name ?? e.productType ?? e.name;
  const details = [e.dimensions, e.woodSpecies].filter(Boolean).join(" · ") || null;
  const depositBps = Math.round((e.depositPct ?? 0) * 100);
  const quote = await prisma.$transaction(async (tx) => {
    const q = await createManualQuote(
      admin,
      {
        source: "ESTIMATE",
        name: c.name,
        email: c.email,
        phone: c.phone,
        zipCode: c.zipCode,
        address: null,
        notes: e.notes,
        productId: e.product?.id ?? null,
        productName: description,
        requestedDimensions: e.dimensions,
        estimatedTotalCents: price,
        lines: [{ kind: "CUSTOM", description, notes: details, quantity: 1, unitPriceCents: price, taxable: true, productId: e.product?.id ?? null, configuration: null }],
        deposit: depositBps > 0 ? { depositType: "PERCENTAGE", depositPercentBps: Math.min(10000, depositBps), depositAmountCents: null } : { depositType: "NONE", depositPercentBps: null, depositAmountCents: null },
      },
      tx,
    );
    await tx.internalNote.create({ data: { body: summary, authorId: admin.id, quoteRequestId: q.id } });
    await tx.priceEstimate.update({
      where: { id: e.id },
      data: { quoteRequestId: q.id, customerName: c.name, customerEmail: c.email, customerPhone: c.phone, customerZip: c.zipCode || null },
    });
    return q;
  });
  await logActivity("estimate.converted", `${admin.name} converted estimate "${e.name}" into quote ${quote.number}`, {
    actorId: admin.id,
    entityType: "quote",
    entityId: quote.id,
  });
  refresh(e.id);
  revalidatePath("/admin/quotes");
  return { ok: true, id: quote.id, message: `Quote ${quote.number} created as a draft — review and send it from Quotes.` };
});

/**
 * "Attach estimate": link a saved estimate to an existing quote (by its
 * number, e.g. WMQ-1004) as internal pricing backup. The quote's lines are
 * not changed, and the breakdown is only ever visible in admin.
 */
export const attachEstimateToQuote = adminAction(async (admin, estimateId: string, data: FormData) => {
  const e = await prisma.priceEstimate.findUnique({ where: { id: estimateId } });
  if (!e) throw new AdminError("That estimate no longer exists.");
  if (e.quoteRequestId) throw new AdminError("This estimate is already linked to a quote.");
  const number = fd.str(data, "quoteNumber").toUpperCase();
  if (!/^WMQ-\d{4,}$/.test(number)) throw new AdminError("Enter a quote number like WMQ-1004.", { quoteNumber: "Enter a quote number like WMQ-1004." });
  const quote = await prisma.quoteRequest.findUnique({ where: { number }, select: { id: true, number: true } });
  if (!quote) throw new AdminError("No quote has that number.", { quoteNumber: "No quote has that number." });
  await prisma.$transaction([
    prisma.priceEstimate.update({ where: { id: e.id }, data: { quoteRequestId: quote.id } }),
    prisma.internalNote.create({ data: { body: estimateSummary(e, e.finalPriceCents ?? e.baseRecommendedCents), authorId: admin.id, quoteRequestId: quote.id } }),
  ]);
  await logActivity("estimate.converted", `${admin.name} attached estimate "${e.name}" to quote ${quote.number}`, { actorId: admin.id, entityType: "quote", entityId: quote.id });
  refresh(e.id);
  revalidatePath(`/admin/quotes/${quote.id}`);
  return { ok: true, id: quote.id, message: `Estimate attached to ${quote.number}.` };
});

/**
 * Deliberately push pricing from the calculator to a product. Only the fields
 * the admin ticks are changed. This affects the public site immediately if
 * the product is live and prices are shown.
 */
export const updateProductPricing = adminAction(async (admin, productId: string, data: FormData) => {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, saleEnabled: true, saleType: true, salePercentBps: true, salePriceCents: true } });
  if (!product) throw new AdminError("That product no longer exists.");
  const update: Prisma.ProductUpdateInput = {};
  const changes: string[] = [];
  if (fd.bool(data, "applyBasePrice")) {
    const cents = parseDollarsToCents(fd.str(data, "basePrice"));
    if (cents == null || Number.isNaN(cents) || cents <= 0) throw new AdminError("Enter a valid base price.", { basePrice: "Enter an amount." });
    // Percent sales follow the new regular price; a fixed sale price must stay below it.
    const salePrice = salePriceFor({ ...product, basePriceCents: cents });
    if (salePrice != null && cents <= salePrice) {
      throw new AdminError(
        `“${product.name}” has a sale price of ${formatCents(salePrice)}. The regular price must be higher — change or remove the sale in the product editor first.`,
        { basePrice: "Must be higher than the product's sale price." },
      );
    }
    update.basePriceCents = cents;
    changes.push(`base price ${formatCents(cents)}`);
  }
  if (fd.bool(data, "applyMaterials")) {
    const cents = parseDollarsToCents(fd.str(data, "materialCost"));
    if (cents == null || Number.isNaN(cents) || cents < 0) throw new AdminError("Enter a valid material cost.");
    update.estMaterialCostCents = cents;
    changes.push(`material estimate ${formatCents(cents)}`);
  }
  if (fd.bool(data, "applyLabor")) {
    const hours = Number(fd.str(data, "laborHours"));
    if (!Number.isFinite(hours) || hours < 0 || hours > 10_000) throw new AdminError("Enter valid labor hours.");
    update.estLaborHours = hours;
    changes.push(`labor estimate ${hours} h`);
  }
  if (!changes.length) throw new AdminError("Choose at least one value to update.");
  await prisma.product.update({ where: { id: product.id }, data: update });
  await logActivity("product.updated", `${admin.name} updated pricing for "${product.name}" from the calculator (${changes.join(", ")})`, {
    actorId: admin.id,
    entityType: "product",
    entityId: product.id,
  });
  revalidateSite();
  return { ok: true, message: `Updated ${product.name}: ${changes.join(", ")}.` };
});

/* -------------------------------------------------------------- settings */

const pctText = (max: number) =>
  z.string().trim().transform((v, ctx) => {
    const n = Number(v);
    if (v === "" || !Number.isFinite(n) || n < 0 || n > max) {
      ctx.addIssue({ code: "custom", message: `Enter a number from 0 to ${max}.` });
      return 0;
    }
    return n;
  });
const moneyField = z.string().transform((v, ctx) => {
  const c = parseDollarsToCents(v);
  if (c == null || Number.isNaN(c) || c < 0) {
    ctx.addIssue({ code: "custom", message: "Enter an amount like 45 or 1,200." });
    return 0;
  }
  return c;
});

export const savePricingSettings = adminAction(async (admin, data: FormData) => {
  const v = z
    .object({
      pricingLaborRateCents: moneyField,
      pricingLumberWastePct: pctText(200),
      pricingMaterialWastePct: pctText(200),
      pricingOverheadPct: pctText(500),
      pricingOverheadMethod: z.enum(["percent", "allocated"]),
      pricingMonthlyOverheadCents: moneyField,
      pricingProjectsPerMonth: z.string().transform((s, ctx) => {
        const n = Number(s);
        if (!Number.isInteger(n) || n < 1 || n > 1000) ctx.addIssue({ code: "custom", message: "Enter a whole number of at least 1." });
        return n;
      }),
      pricingTargetMarginPct: pctText(95),
      pricingMinMarginWarnPct: pctText(95),
      pricingMaterialsLaborWarnPct: pctText(100),
      pricingDepositPct: pctText(100),
      pricingRoundToDollars: z.enum(["0", "10", "25", "50", "100"]).transform(Number),
    })
    .parse({
      pricingLaborRateCents: fd.str(data, "pricingLaborRateCents"),
      pricingLumberWastePct: fd.str(data, "pricingLumberWastePct"),
      pricingMaterialWastePct: fd.str(data, "pricingMaterialWastePct"),
      pricingOverheadPct: fd.str(data, "pricingOverheadPct"),
      pricingOverheadMethod: fd.str(data, "pricingOverheadMethod"),
      pricingMonthlyOverheadCents: fd.str(data, "pricingMonthlyOverheadCents"),
      pricingProjectsPerMonth: fd.str(data, "pricingProjectsPerMonth"),
      pricingTargetMarginPct: fd.str(data, "pricingTargetMarginPct"),
      pricingMinMarginWarnPct: fd.str(data, "pricingMinMarginWarnPct"),
      pricingMaterialsLaborWarnPct: fd.str(data, "pricingMaterialsLaborWarnPct"),
      pricingDepositPct: fd.str(data, "pricingDepositPct"),
      pricingRoundToDollars: fd.str(data, "pricingRoundToDollars"),
    });
  await prisma.siteSetting.upsert({ where: { id: "default" }, update: v, create: { id: "default", ...v } });
  await logActivity("pricing.settings_updated", `${admin.name} updated pricing calculator defaults`, { actorId: admin.id });
  revalidatePath("/admin/settings/pricing");
  revalidatePath("/admin/pricing-calculator");
  return { ok: true, message: "Pricing defaults saved." };
});
