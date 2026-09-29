import { describe, expect, it } from "vitest";
import { boardFeet, computeEstimate, defaultEstimateInputs, type EstimateInputs } from "@/lib/pricing/estimator";

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
  }),
  materials: [{ id: "m", description: "Materials", quantity: 1, unitCostCents: 30000 }],
  laborHours: 10, // 10 h × $40 = $400
});

describe("pricing calculator", () => {
  it("computes board feet: thickness × width × length(ft) ÷ 12", () => {
    // 8/4 white oak, 8" wide, 8' long → 2 × 8 × 8 / 12 = 10.667 BF each
    expect(boardFeet(2, 8, 8)).toBeCloseTo(10.6667, 3);
    const r = computeEstimate(
      { ...base(), materials: [], lumberWastePct: 15, lumber: [{ id: "l", description: "White Oak", thicknessIn: 2, widthIn: 8, lengthFt: 8, quantity: 4, pricePerBoardFootCents: 830 }] },
      thresholds,
    );
    expect(r.lumber.boardFeet).toBeCloseTo(42.667, 2);
    expect(r.lumber.rawCents).toBe(35413); // 42.667 × $8.30
    expect(r.lumber.wasteCents).toBe(5312); // 15%
    expect(r.materialCostCents).toBe(40725);
  });

  it("materials ÷ 0.30 and (materials + labor) ÷ 0.50 checks match the examples", () => {
    const r = computeEstimate(base(), thresholds);
    expect(r.materialCostCents).toBe(30000);
    expect(r.laborCostCents).toBe(40000);
    expect(r.methods.materialsCheckCents).toBe(100000); // $300 / 0.30 = $1,000
    expect(r.methods.fiftyCheckCents).toBe(140000); // $700 / 0.50 = $1,400
  });

  it("full cost + margin uses cost ÷ (1 − margin), not markup", () => {
    const r = computeEstimate({ ...base(), overheadMethod: "allocated", monthlyOverheadCents: 30000, projectsPerMonth: 4 }, thresholds);
    expect(r.overheadCostCents).toBe(7500); // $300 / 4 projects
    expect(r.totalCostCents).toBe(77500);
    expect(r.methods.fullCostPriceCents).toBe(119231); // $775 / 0.65 = $1,192.31
    // $1,000 cost at 35% margin ≈ $1,538, not $1,350
    const k = computeEstimate({ ...base(), materials: [{ id: "m", description: "", quantity: 1, unitCostCents: 100000 }], laborHours: 0, overheadPct: 0 }, thresholds);
    expect(k.methods.fullCostPriceCents).toBe(153846);
  });

  it("applies percentage overhead to materials + labor", () => {
    expect(computeEstimate(base(), thresholds).overheadCostCents).toBe(3500); // 5% of $700
  });

  it("analyzes a proposed price (the $1,500 example)", () => {
    const r = computeEstimate({ ...base(), overheadMethod: "allocated", monthlyOverheadCents: 30000, projectsPerMonth: 4, proposedPriceCents: 150000 }, thresholds);
    expect(r.analysis).toMatchObject({ priceCents: 150000, source: "proposed", profitCents: 72500 });
    expect(r.analysis!.marginPct).toBeCloseTo(48.33, 2);
    expect(r.analysis!.materialsLaborPct).toBeCloseTo(46.67, 2);
    expect(r.warnings).toEqual([]);
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

  it("gives advisory warnings for thin margins, heavy materials + labor and losses", () => {
    const thin = computeEstimate({ ...base(), proposedPriceCents: 90000 }, thresholds);
    const messages = thin.warnings.map((w) => w.message).join(" | ");
    expect(messages).toMatch(/less than a 25% projected margin/);
    expect(messages).toMatch(/Materials and labor exceed 50%/);
    const loss = computeEstimate({ ...base(), proposedPriceCents: 50000 }, thresholds);
    expect(loss.warnings[0]).toMatchObject({ level: "danger", message: "This price would produce a projected loss." });
  });

  it("handles impossible margins and empty inputs without throwing", () => {
    const r = computeEstimate({ ...base(), targetMarginPct: 100 }, thresholds);
    expect(r.methods.fullCostPriceCents).toBeNull();
    expect(r.warnings.some((w) => /100%/.test(w.message))).toBe(true);
    const empty = computeEstimate({ ...base(), materials: [], laborHours: 0 }, thresholds);
    expect(empty.totalCostCents).toBe(0);
    expect(computeEstimate({ ...base(), overheadMethod: "allocated", projectsPerMonth: 0, monthlyOverheadCents: 100 }, thresholds).overheadCostCents).toBe(0);
  });
});
