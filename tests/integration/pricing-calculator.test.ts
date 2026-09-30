import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, jar, resetRequest } = await import("../support/next-request");
const { defaultEstimateInputs } = await import("@/lib/pricing/estimator");
const actions = await import("@/app/admin/(panel)/pricing-calculator/actions");
const { hasTestDb, resetDb } = await import("../support/db");

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const inputs = {
  ...defaultEstimateInputs({
    laborRateCents: 4000,
    lumberWastePct: 0,
    materialWastePct: 0,
    overheadPct: 0,
    overheadMethod: "allocated",
    monthlyOverheadCents: 30000,
    projectsPerMonth: 4,
    targetMarginPct: 35,
    depositPct: 50,
    roundToDollars: 0,
  }),
  productType: "Dining table",
  dimensions: '84" × 40"',
  woodSpecies: "White oak",
  materials: [{ id: "m", description: "White oak & hardware", category: "material" as const, quantity: 1, unitCostCents: 30000 }],
  laborHours: 10,
  manualPriceCents: 150000,
};

describe.skipIf(!hasTestDb)("pricing calculator actions", () => {
  beforeEach(async () => {
    await resetDb();
    resetRequest();
    await prisma.siteSetting.create({ data: { id: "default" } });
    await createSignedInAdmin();
  });

  it("requires an admin session", async () => {
    jar.clear();
    await expect(actions.saveEstimate(null, form({ name: "X", inputs: JSON.stringify(inputs) }))).rejects.toThrow(/REDIRECT \/admin\/login/);
  });

  it("recalculates results on the server when saving", async () => {
    const res = await actions.saveEstimate(null, form({ name: 'Smith 84" White Oak Dining Table', inputs: JSON.stringify(inputs) }));
    expect(res.ok).toBe(true);
    const e = await prisma.priceEstimate.findUniqueOrThrow({ where: { id: res.id! } });
    expect(e).toMatchObject({
      productType: "Dining table",
      dimensions: '84" × 40"',
      woodSpecies: "White oak",
      materialCostCents: 30000,
      laborHours: 10,
      laborCostCents: 40000,
      otherDirectCostCents: 0,
      overheadCostCents: 7500,
      totalCostCents: 77500,
      floorCents: 100000,
      detailedPriceCents: 119231,
      baseRecommendedCents: 119231,
      valueAdjustmentCents: 0,
      finalRecommendedCents: 119231,
      fiftyCheckCents: 140000,
      finalPriceCents: 150000,
      manualPrice: true,
      depositPct: 50,
      depositCents: 75000,
      balanceCents: 75000,
      grossProfitCents: 80000,
      netProfitCents: 72500,
    });
    expect(e.grossMarginPct).toBeCloseTo(53.33, 2);
  });

  it("stores the recommended price, adjustments and deposit when no manual price is set (Test 6)", async () => {
    const test6 = {
      ...inputs,
      materials: [{ id: "m", description: "Slab & base", category: "material" as const, quantity: 1, unitCostCents: 60000 }],
      laborHours: 0,
      overheadMethod: "percent" as const,
      overheadPct: 0,
      manualPriceCents: null,
      roundToDollars: 50,
    };
    const { id } = await actions.saveEstimate(null, form({ name: "Test 6", inputs: JSON.stringify(test6) }));
    expect(await prisma.priceEstimate.findUniqueOrThrow({ where: { id: id! } })).toMatchObject({
      floorCents: 200000,
      baseRecommendedCents: 200000,
      finalPriceCents: 200000,
      manualPrice: false,
      depositCents: 100000,
      balanceCents: 100000,
    });
    const adjusted = { ...test6, valueAdjustments: [{ id: "a", label: "Rush order", mode: "percent" as const, value: 10 }] };
    const res = await actions.saveEstimate(id!, form({ name: "Test 6", inputs: JSON.stringify(adjusted) }));
    expect(res.ok).toBe(true);
    expect(await prisma.priceEstimate.findUniqueOrThrow({ where: { id: id! } })).toMatchObject({ valueAdjustmentCents: 20000, finalRecommendedCents: 220000, finalPriceCents: 220000 });
  });

  it("rejects out-of-range inputs", async () => {
    const bad = await actions.saveEstimate(null, form({ name: "Bad", inputs: JSON.stringify({ ...inputs, targetMarginPct: 150 }) }));
    expect(bad.ok).toBe(false);
    expect(await prisma.priceEstimate.count()).toBe(0);
  });

  it("duplicates, archives and converts into a quote without touching products", async () => {
    const product = await prisma.product.create({ data: { name: "Ridge", slug: "ridge", basePriceCents: 129500, status: "ACTIVE" } });
    const { id } = await actions.saveEstimate(null, form({ name: "Estimate", productId: product.id, inputs: JSON.stringify(inputs) }));
    const dup = await actions.duplicateEstimate(id!);
    expect((await prisma.priceEstimate.findUniqueOrThrow({ where: { id: dup.id! } })).name).toBe("Copy of Estimate");
    await actions.setEstimateArchived(dup.id!, true);
    expect((await prisma.priceEstimate.findUniqueOrThrow({ where: { id: dup.id! } })).archivedAt).not.toBeNull();

    const converted = await actions.convertEstimateToQuote(id!, form({ name: "Pat Smith", email: "pat@example.com", phone: "", zipCode: "43215" }));
    expect(converted.ok).toBe(true);
    const quote = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: converted.id! }, include: { internalNotes: true } });
    expect(quote).toMatchObject({ status: "QUOTED", estimatedTotalCents: 150000, productId: product.id, requestedDimensions: '84" × 40"' });
    const note = quote.internalNotes[0]!.body;
    expect(note).toMatch(/30% pricing floor \$1,000/);
    expect(note).toMatch(/Gross profit \$800/);
    expect(note).toMatch(/Deposit 50%: \$750/);
    expect((await actions.convertEstimateToQuote(id!, form({ name: "Pat Smith", email: "pat@example.com", zipCode: "" }))).ok).toBe(false);

    // Saving or converting never changes the product's price.
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).basePriceCents).toBe(129500);
  });

  it("updates product pricing only when explicitly requested, field by field", async () => {
    const product = await prisma.product.create({ data: { name: "Ridge", slug: "ridge", basePriceCents: 129500 } });
    const none = await actions.updateProductPricing(product.id, form({ basePrice: "1500" }));
    expect(none.ok).toBe(false);
    const res = await actions.updateProductPricing(product.id, form({ applyBasePrice: "on", basePrice: "1,500", applyLabor: "on", laborHours: "22.5", materialCost: "999" }));
    expect(res.ok).toBe(true);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ basePriceCents: 150000, estLaborHours: 22.5, estMaterialCostCents: null });
  });

  it("saves pricing defaults with validation", async () => {
    const good = await actions.savePricingSettings(
      form({
        pricingLaborRateCents: "55",
        pricingLumberWastePct: "20",
        pricingMaterialWastePct: "0",
        pricingOverheadPct: "5",
        pricingOverheadMethod: "allocated",
        pricingMonthlyOverheadCents: "1,200",
        pricingProjectsPerMonth: "3",
        pricingTargetMarginPct: "40",
        pricingMinMarginWarnPct: "25",
        pricingMaterialsLaborWarnPct: "50",
        pricingDepositPct: "40",
        pricingRoundToDollars: "100",
      }),
    );
    expect(good.ok).toBe(true);
    expect(await prisma.siteSetting.findUniqueOrThrow({ where: { id: "default" } })).toMatchObject({ pricingLaborRateCents: 5500, pricingMonthlyOverheadCents: 120000, pricingOverheadMethod: "allocated", pricingDepositPct: 40, pricingRoundToDollars: 100 });
    const bad = await actions.savePricingSettings(form({ pricingLaborRateCents: "abc", pricingProjectsPerMonth: "0", pricingOverheadMethod: "percent" }));
    expect(bad.ok).toBe(false);
  });
});
