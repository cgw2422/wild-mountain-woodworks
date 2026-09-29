import type { EstimateThresholds, OverheadMethod } from "./estimator";

type PricingSettings = {
  pricingLaborRateCents: number;
  pricingLumberWastePct: number;
  pricingMaterialWastePct: number;
  pricingOverheadPct: number;
  pricingOverheadMethod: string;
  pricingMonthlyOverheadCents: number;
  pricingProjectsPerMonth: number;
  pricingTargetMarginPct: number;
  pricingMinMarginWarnPct: number;
  pricingMaterialsLaborWarnPct: number;
};

/** Calculator defaults from Settings → Pricing. */
export function pricingDefaults(s: PricingSettings) {
  return {
    laborRateCents: s.pricingLaborRateCents,
    lumberWastePct: s.pricingLumberWastePct,
    materialWastePct: s.pricingMaterialWastePct,
    overheadPct: s.pricingOverheadPct,
    overheadMethod: (s.pricingOverheadMethod === "allocated" ? "allocated" : "percent") as OverheadMethod,
    monthlyOverheadCents: s.pricingMonthlyOverheadCents,
    projectsPerMonth: s.pricingProjectsPerMonth,
    targetMarginPct: s.pricingTargetMarginPct,
  };
}

export function pricingThresholds(s: PricingSettings): EstimateThresholds {
  return { minMarginPct: s.pricingMinMarginWarnPct, materialsLaborPct: s.pricingMaterialsLaborWarnPct };
}
