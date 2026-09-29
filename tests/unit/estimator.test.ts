import { describe, expect, it } from "vitest";
import {
  BELOW_FLOOR_WARNING,
  boardFeet,
  computeEstimate,
  defaultEstimateInputs,
  pricingFloorCents,
  roundUpToDollars,
  type EstimateInputs,
} from "@/lib/pricing/estimator";
import { estimateInputsSchema } from "@/lib/pricing/estimate-schema";

const thresholds = { minMarginPct: 25, materialsLaborPct: 50 };
const base = (): EstimateInputs => ({
  ...defaultEstimateInputs({
    laborRateCents: 4000,
    lumberWastePct: 0,
    materialWastePct: 0,
    overheadPct: 5,
    overheadMethod: "percent",
    monthlyOverheadCents: 0,
    projectsPerMonth: 4,
    targetMarginPct: 35,
    depositPct: 50,
    roundToDollars: 0,
  }),
  materials: [{ id: "m", description: "Materials", category: "material", quantity: 1, unitCostCents: 30000 }],
  laborHours: 10, // 10 h × $40 = $400
});

/** Only materials, no overhead, $50/h shop rate. */
const scenario = (materialCents: number, laborHours = 0, extra: Partial<EstimateInputs> = {}): EstimateInputs => ({
  ...base(),
  materials: [{ id: "m", description: "Materials", category: "material", quantity: 1, unitCostCents: materialCents }],
  laborHours,
  laborRateCents: 5000,
  overheadPct: 0,
  ...extra,
});

describe("required pricing scenarios", () => {
  it("Test 1: materials $300 → floor $1,000", () => {
    expect(computeEstimate(scenario(30000), thresholds).pricing.floorCents).toBe(100000);
  });

  it("Test 2: materials $600 → floor $2,000", () => {
    expect(computeEstimate(scenario(60000), thresholds).pricing.floorCents).toBe(200000);
  });

  it("Test 3: materials $900 → floor $3,000", () => {
    expect(computeEstimate(scenario(90000), thresholds).pricing.floorCents).toBe(300000);
  });

  it("Test 4: materials $450, detailed $1,750 → floor $1,500, base $1,750", () => {
    // $450 + 13.75 h × $50 ($687.50) = $1,137.50 ÷ 0.65 = $1,750
    const r = computeEstimate(scenario(45000, 13.75), thresholds);
    expect(r.pricing.floorCents).toBe(150000);
    expect(r.pricing.detailedPriceCents).toBe(175000);
    expect(r.pricing.baseRecommendedCents).toBe(175000);
    expect(r.pricing.basis).toBe("detailed");
  });

  it("Test 5: materials $600, detailed $1,700 → floor $2,000, base $2,000 (never averaged)", () => {
    // $600 + 10.1 h × $50 ($505) = $1,105 ÷ 0.65 = $1,700
    const r = computeEstimate(scenario(60000, 10.1), thresholds);
    expect(r.pricing.floorCents).toBe(200000);
    expect(r.pricing.detailedPriceCents).toBe(170000);
    expect(r.pricing.baseRecommendedCents).toBe(200000);
    expect(r.pricing.basis).toBe("floor");
  });

  it("Test 6: materials $600, final $2,000, 50% deposit → $1,000 deposit, $1,000 balance, materials covered, $400 left", () => {
    const r = computeEstimate(scenario(60000, 0, { manualPriceCents: 200000, depositPct: 50 }), thresholds);
    expect(r.finalPriceCents).toBe(200000);
    expect(r.deposit).toEqual({ pct: 50, depositCents: 100000, balanceCents: 100000, coversMaterials: true, afterMaterialsCents: 40000 });
    // The recommendation alone lands on the same numbers.
    const rec = computeEstimate(scenario(60000), thresholds);
    expect(rec.finalPriceCents).toBe(200000);
    expect(rec.deposit.depositCents).toBe(100000);
  });
});

describe("pricing floor, adjustments, rounding and override", () => {
  it("floor excludes labor, supplies and other direct costs", () => {
    const r = computeEstimate(
      scenario(30000, 20, {
        materials: [
          { id: "a", description: "Legs", category: "material", quantity: 1, unitCostCents: 20000 },
          { id: "b", description: "Hardware", category: "material", quantity: 2, unitCostCents: 5000 },
          { id: "c", description: "Stain", category: "supplies", quantity: 1, unitCostCents: 4000 },
        ],
        otherCosts: [{ id: "d", kind: "delivery", description: "", amountCents: 15000 }],
      }),
      thresholds,
    );
    expect(r.materialCostCents).toBe(30000);
    expect(r.suppliesCostCents).toBe(4000);
    expect(r.otherDirectCostCents).toBe(19000);
    expect(r.pricing.floorCents).toBe(100000);
    // Detailed includes everything: 300 + 40 + 150 + 1,000 labor = 1,490 ÷ 0.65
    expect(r.totalCostCents).toBe(149000);
    expect(r.pricing.detailedPriceCents).toBe(229231);
  });

  it("includes lumber (with waste) in material cost", () => {
    const r = computeEstimate(
      { ...base(), materials: [], lumberWastePct: 15, lumber: [{ id: "l", description: "White Oak", thicknessIn: 2, widthIn: 8, lengthFt: 8, quantity: 4, pricePerBoardFootCents: 830 }] },
      thresholds,
    );
    expect(boardFeet(2, 8, 8)).toBeCloseTo(10.6667, 3);
    expect(r.lumber.boardFeet).toBeCloseTo(42.667, 2);
    expect(r.lumber.rawCents).toBe(35413);
    expect(r.lumber.wasteCents).toBe(5312);
    expect(r.materialCostCents).toBe(40725);
    expect(r.pricing.floorCents).toBe(pricingFloorCents(40725));
  });

  it("applies value adjustments only when entered ($ and % of base)", () => {
    const none = computeEstimate(scenario(60000), thresholds);
    expect(none.pricing.valueAdjustmentCents).toBe(0);
    expect(none.pricing.finalRecommendedCents).toBe(200000);
    const r = computeEstimate(
      scenario(60000, 0, {
        valueAdjustments: [
          { id: "a", label: "Rush order", mode: "percent", value: 10 },
          { id: "b", label: "Premium hardwood", mode: "amount", value: 15000 },
        ],
      }),
      thresholds,
    );
    expect(r.pricing.baseRecommendedCents).toBe(200000);
    expect(r.pricing.adjustments.map((a) => a.cents)).toEqual([20000, 15000]);
    expect(r.pricing.valueAdjustmentCents).toBe(35000);
    expect(r.pricing.finalRecommendedCents).toBe(235000);
  });

  it("rounds up to clean numbers and never below the floor", () => {
    expect(roundUpToDollars(148300, 50)).toBe(150000);
    expect(roundUpToDollars(192700, 50)).toBe(195000);
    expect(roundUpToDollars(192700, 100)).toBe(200000);
    expect(roundUpToDollars(150000, 50)).toBe(150000);
    expect(roundUpToDollars(148321, 0)).toBe(148321);
    // Floor $1,483.33 (materials $445) rounds UP to $1,500, never down to $1,450.
    const r = computeEstimate(scenario(44500, 0, { roundToDollars: 50 }), thresholds);
    expect(r.pricing.floorCents).toBe(148333);
    expect(r.pricing.finalRecommendedCents).toBe(150000);
    expect(r.pricing.roundingCents).toBe(1667);
    expect(r.pricing.finalRecommendedCents).toBeGreaterThanOrEqual(r.pricing.floorCents);
  });

  it("allows a manual price below the floor but warns", () => {
    const r = computeEstimate(scenario(60000, 0, { manualPriceCents: 180000 }), thresholds);
    expect(r.finalPriceCents).toBe(180000);
    expect(r.manualPrice).toBe(true);
    expect(r.belowFloor).toBe(true);
    expect(r.warnings[0]).toMatchObject({ code: "below-floor", level: "danger", message: BELOW_FLOOR_WARNING });
    expect(r.profit.materialsPct).toBeCloseTo(33.33, 2);
    const ok = computeEstimate(scenario(60000, 0, { manualPriceCents: 200000 }), thresholds);
    expect(ok.belowFloor).toBe(false);
  });

  it("computes the profit breakdown with overhead shown separately", () => {
    const r = computeEstimate(
      { ...base(), overheadMethod: "allocated", monthlyOverheadCents: 30000, projectsPerMonth: 4, otherCosts: [{ id: "o", kind: "installation", description: "", amountCents: 10000 }], manualPriceCents: 150000 },
      thresholds,
    );
    expect(r.overheadCostCents).toBe(7500);
    expect(r.profit).toMatchObject({
      sellingPriceCents: 150000,
      materialCostCents: 30000,
      laborCostCents: 40000,
      otherDirectCostCents: 10000,
      grossProfitCents: 70000, // 1,500 − 300 − 400 − 100
      overheadCostCents: 7500,
      netProfitCents: 62500,
    });
    expect(r.profit.materialsPct).toBe(20);
    expect(r.profit.grossMarginPct).toBeCloseTo(46.67, 2);
  });
});

describe("cost calculation", () => {
  it("detailed price uses cost ÷ (1 − margin), not markup", () => {
    const r = computeEstimate({ ...base(), overheadMethod: "allocated", monthlyOverheadCents: 30000, projectsPerMonth: 4 }, thresholds);
    expect(r.totalCostCents).toBe(77500);
    expect(r.pricing.detailedPriceCents).toBe(119231); // $775 / 0.65
    expect(r.pricing.fiftyCheckCents).toBe(140000); // reference: $700 / 0.50
    const k = computeEstimate({ ...base(), materials: [{ id: "m", description: "", category: "material", quantity: 1, unitCostCents: 100000 }], laborHours: 0, overheadPct: 0 }, thresholds);
    expect(k.pricing.detailedPriceCents).toBe(153846);
  });

  it("applies percentage overhead to direct costs", () => {
    expect(computeEstimate(base(), thresholds).overheadCostCents).toBe(3500); // 5% of $700
  });

  it("supports labor phases with individual rates", () => {
    const i = base();
    i.laborMode = "phases";
    i.laborPhases = [
      { id: "a", name: "Milling", hours: 4, rateCents: 4000 },
      { id: "b", name: "Finishing", hours: 2.5, rateCents: 5000 },
    ];
    const r = computeEstimate(i, thresholds);
    expect(r.laborHours).toBe(6.5);
    expect(r.laborCostCents).toBe(16000 + 12500);
  });

  it("gives advisory warnings for thin margins, losses and deposit shortfalls", () => {
    const thin = computeEstimate({ ...base(), manualPriceCents: 90000 }, thresholds);
    const codes = thin.warnings.map((w) => w.code);
    expect(codes).toContain("below-floor");
    expect(codes).toContain("low-margin");
    expect(codes).toContain("materials-labor");
    const loss = computeEstimate({ ...base(), manualPriceCents: 50000 }, thresholds);
    expect(loss.warnings.map((w) => w.code)).toContain("loss");
    const short = computeEstimate(scenario(60000, 0, { depositPct: 25 }), thresholds);
    expect(short.deposit.coversMaterials).toBe(false);
    expect(short.warnings.map((w) => w.code)).toContain("deposit-short");
  });

  it("handles impossible margins and empty inputs without throwing", () => {
    const r = computeEstimate({ ...base(), targetMarginPct: 100 }, thresholds);
    expect(r.pricing.detailedPriceCents).toBeNull();
    expect(r.pricing.basis).toBe("floor");
    expect(r.warnings.some((w) => w.code === "impossible-margin")).toBe(true);
    const empty = computeEstimate({ ...base(), materials: [], laborHours: 0 }, thresholds);
    expect(empty.totalCostCents).toBe(0);
    expect(empty.finalPriceCents).toBe(0);
    expect(computeEstimate({ ...base(), overheadMethod: "allocated", projectsPerMonth: 0, monthlyOverheadCents: 100 }, thresholds).overheadCostCents).toBe(0);
  });
});

describe("saved inputs schema", () => {
  it("reads estimates saved before the floor update", () => {
    const old = {
      lumber: [],
      lumberWastePct: 15,
      materials: [{ id: "m", description: "Legs", quantity: 1, unitCostCents: 30000 }],
      materialWastePct: 0,
      laborMode: "simple",
      laborHours: 10,
      laborRateCents: 4000,
      laborPhases: [],
      overheadMethod: "percent",
      overheadPct: 5,
      monthlyOverheadCents: 0,
      projectsPerMonth: 4,
      targetMarginPct: 35,
      proposedPriceCents: 150000,
    };
    const parsed = estimateInputsSchema.parse(old);
    expect(parsed.manualPriceCents).toBe(150000);
    expect(parsed.materials[0]!.category).toBe("material");
    expect(parsed).toMatchObject({ otherCosts: [], valueAdjustments: [], roundToDollars: 0, depositPct: 50, productType: "" });
  });
});
