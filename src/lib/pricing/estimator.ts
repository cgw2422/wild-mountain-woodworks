/**
 * Internal pricing calculator (admin decision-support only).
 *
 * Pure and framework-free: the admin UI uses it for live results and the
 * server re-runs it when an estimate is saved. Money is integer cents,
 * percentages are plain numbers (35 = 35%).
 *
 * Pricing methodology
 *   1. Pricing floor        = Material Cost ÷ 0.30   (materials never exceed 30% of the price)
 *   2. Detailed price       = Total project cost ÷ (1 − target margin)
 *   3. Base recommended     = MAX(floor, detailed)   (never averaged)
 *   4. Final recommended    = base + optional value adjustments, optionally rounded UP
 *   5. Final selling price  = manual override if entered, otherwise the final recommendation
 *
 * "Material Cost" is every direct physical material that ends up in the piece
 * (lumber, legs/bases, hardware, slides, hinges, fasteners, epoxy, purchased
 * components …). Finishing consumables and shop supplies are tracked
 * separately as "supplies" so nothing is counted twice. Labor is never part
 * of the floor.
 *
 * Margin vs markup: margin is profit as a share of the SELLING PRICE, so
 *   selling price = cost / (1 − margin)
 * A $1,000 cost at a 35% margin is $1,538.46 — not $1,350 (that would be a
 * 35% markup on cost).
 */

export interface LumberLine {
  id: string;
  description: string;
  thicknessIn: number; // e.g. 8/4 stock = 2
  widthIn: number;
  lengthFt: number;
  quantity: number;
  pricePerBoardFootCents: number;
}

/** "material" counts toward Material Cost (and the floor); "supplies" are finishing consumables / shop supplies. */
export type MaterialCategory = "material" | "supplies";

export interface MaterialLine {
  id: string;
  description: string;
  category: MaterialCategory;
  quantity: number;
  unitCostCents: number;
}

export type OtherCostKind = "delivery" | "installation" | "outsourced" | "other";

export interface OtherCostLine {
  id: string;
  kind: OtherCostKind;
  description: string;
  amountCents: number;
}

export interface LaborPhase {
  id: string;
  name: string;
  hours: number;
  rateCents: number;
}

/** Optional, admin-entered premium. Percent adjustments apply to the base recommended price. */
export interface ValueAdjustment {
  id: string;
  label: string;
  mode: "amount" | "percent";
  /** Cents when mode = "amount"; percent (10 = 10%) when mode = "percent". */
  value: number;
}

export type OverheadMethod = "percent" | "allocated";
export type LaborMode = "simple" | "phases";

export interface EstimateInputs {
  productType: string;
  dimensions: string;
  woodSpecies: string;
  lumber: LumberLine[];
  lumberWastePct: number;
  materials: MaterialLine[];
  /** Waste allowance on "material" lines (not supplies). */
  materialWastePct: number;
  otherCosts: OtherCostLine[];
  laborMode: LaborMode;
  laborHours: number;
  laborRateCents: number;
  laborPhases: LaborPhase[];
  overheadMethod: OverheadMethod;
  /** Percent of direct costs (materials + supplies + labor + other direct costs). */
  overheadPct: number;
  monthlyOverheadCents: number;
  projectsPerMonth: number;
  targetMarginPct: number;
  valueAdjustments: ValueAdjustment[];
  /** Round the recommendation UP to a multiple of this many dollars (0 = off). */
  roundToDollars: number;
  /** Manual final selling price. Never blocked — only warned about. */
  manualPriceCents: number | null;
  depositPct: number;
}

export interface EstimateThresholds {
  minMarginPct: number; // warn below this projected net margin (default 25)
  materialsLaborPct: number; // warn when materials + labor exceed this share of price (default 50)
}

/** Materials may be at most this share of the selling price: floor = materials ÷ 0.30. */
export const MATERIAL_FLOOR_RATIO = 0.3;

export const BELOW_FLOOR_WARNING = "WARNING: This price is below the 30% material-cost pricing floor.";

export const MARGIN_PRESETS = [25, 30, 35, 40, 45] as const;
export const ROUNDING_OPTIONS = [0, 10, 25, 50, 100] as const;

export const DEFAULT_LABOR_PHASES = ["Design", "Milling", "Cutting", "Assembly", "Sanding", "Finishing", "Delivery/install"] as const;

export const OTHER_COST_KINDS: Array<{ value: OtherCostKind; label: string }> = [
  { value: "delivery", label: "Delivery" },
  { value: "installation", label: "Installation" },
  { value: "outsourced", label: "Outsourced work" },
  { value: "other", label: "Other direct expense" },
];

export const VALUE_ADJUSTMENT_PRESETS = [
  "Custom or unique design",
  "High complexity",
  "Premium hardwood",
  "Difficult finish",
  "Personalized/custom details",
  "Rush order",
  "Difficult installation",
  "Premium delivery/service",
  "Lifetime/enhanced warranty",
  "Other",
] as const;

/** Board feet for one piece: thickness (in) × width (in) × length (ft) ÷ 12. */
export function boardFeet(thicknessIn: number, widthIn: number, lengthFt: number): number {
  return (thicknessIn * widthIn * lengthFt) / 12;
}

/** Pricing floor: the lowest price at which materials are ≤ 30% of the sale. */
export function pricingFloorCents(materialCostCents: number): number {
  return Math.round(Math.max(0, materialCostCents) / MATERIAL_FLOOR_RATIO);
}

/** Round UP to the next multiple of `dollars` (0 = no rounding). Never rounds down. */
export function roundUpToDollars(cents: number, dollars: number): number {
  const step = Math.round(dollars * 100);
  if (!(step > 0)) return cents;
  return Math.ceil(cents / step) * step;
}

const finite = (n: number) => (Number.isFinite(n) ? n : 0);
const nonNeg = (n: number) => Math.max(0, finite(n));
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

export type WarningCode = "below-floor" | "loss" | "low-margin" | "materials-labor" | "no-labor" | "deposit-short" | "impossible-margin";

export interface EstimateWarning {
  code: WarningCode;
  level: "caution" | "danger";
  message: string;
}

export interface EstimateResult {
  lumber: {
    lines: Array<{ id: string; boardFeet: number; costCents: number }>;
    boardFeet: number;
    rawCents: number;
    wasteCents: number;
    totalCents: number;
  };
  otherMaterials: {
    lines: Array<{ id: string; totalCents: number }>;
    /** Material-category lines only (before waste). */
    rawCents: number;
    wasteCents: number;
    totalCents: number;
  };
  /** Direct physical materials: lumber + material lines, with waste. The floor is based on this. */
  materialCostCents: number;
  /** Finishing consumables and shop supplies. */
  suppliesCostCents: number;
  /** Delivery, installation, outsourced work and other direct expenses. */
  otherExpensesCents: number;
  /** Supplies + other direct expenses (everything direct except materials and labor). */
  otherDirectCostCents: number;
  laborHours: number;
  laborCostCents: number;
  overheadCostCents: number;
  totalCostCents: number;
  pricing: {
    floorCents: number;
    /** Total cost ÷ (1 − target margin); null when the margin is ≥ 100%. */
    detailedPriceCents: number | null;
    baseRecommendedCents: number;
    basis: "floor" | "detailed";
    adjustments: Array<{ id: string; label: string; cents: number }>;
    valueAdjustmentCents: number;
    /** Base + adjustments, before rounding. */
    adjustedCents: number;
    finalRecommendedCents: number;
    roundingCents: number;
    /** Reference only: (materials + labor) ÷ the materials + labor threshold. */
    fiftyCheckCents: number;
  };
  finalPriceCents: number;
  manualPrice: boolean;
  belowFloor: boolean;
  profit: {
    sellingPriceCents: number;
    materialCostCents: number;
    materialsPct: number | null;
    laborCostCents: number;
    otherDirectCostCents: number;
    grossProfitCents: number;
    grossMarginPct: number | null;
    overheadCostCents: number;
    netProfitCents: number;
    netMarginPct: number | null;
    markupPct: number | null;
    laborPct: number | null;
    materialsLaborPct: number | null;
  };
  deposit: {
    pct: number;
    depositCents: number;
    balanceCents: number;
    coversMaterials: boolean;
    afterMaterialsCents: number;
  };
  warnings: EstimateWarning[];
}

export function computeEstimate(input: EstimateInputs, thresholds: EstimateThresholds): EstimateResult {
  // Lumber (board-foot lines) + waste factor
  const lumberLines = input.lumber.map((l) => {
    const bf = boardFeet(nonNeg(l.thicknessIn), nonNeg(l.widthIn), nonNeg(l.lengthFt)) * nonNeg(l.quantity);
    return { id: l.id, boardFeet: bf, costCents: Math.round(bf * nonNeg(l.pricePerBoardFootCents)) };
  });
  const lumberRaw = lumberLines.reduce((s, l) => s + l.costCents, 0);
  const lumberWaste = Math.round((lumberRaw * nonNeg(input.lumberWastePct)) / 100);

  // Material + supplies line items. Waste applies to materials only.
  const materialLines = input.materials.map((m) => ({ id: m.id, category: m.category, totalCents: Math.round(nonNeg(m.quantity) * nonNeg(m.unitCostCents)) }));
  const materialRaw = materialLines.filter((m) => m.category !== "supplies").reduce((s, m) => s + m.totalCents, 0);
  const materialWaste = Math.round((materialRaw * nonNeg(input.materialWastePct)) / 100);
  const suppliesCostCents = materialLines.filter((m) => m.category === "supplies").reduce((s, m) => s + m.totalCents, 0);

  const materialCostCents = lumberRaw + lumberWaste + materialRaw + materialWaste;
  const otherExpensesCents = input.otherCosts.reduce((s, c) => s + nonNeg(c.amountCents), 0);
  const otherDirectCostCents = suppliesCostCents + otherExpensesCents;

  // Labor: build hours × shop rate (or per-phase rates)
  let laborHours: number;
  let laborCostCents: number;
  if (input.laborMode === "phases") {
    laborHours = input.laborPhases.reduce((s, p) => s + nonNeg(p.hours), 0);
    laborCostCents = input.laborPhases.reduce((s, p) => s + Math.round(nonNeg(p.hours) * nonNeg(p.rateCents)), 0);
  } else {
    laborHours = nonNeg(input.laborHours);
    laborCostCents = Math.round(laborHours * nonNeg(input.laborRateCents));
  }

  const directCostCents = materialCostCents + otherDirectCostCents + laborCostCents;
  const overheadCostCents =
    input.overheadMethod === "allocated"
      ? input.projectsPerMonth > 0
        ? Math.round(nonNeg(input.monthlyOverheadCents) / input.projectsPerMonth)
        : 0
      : Math.round((directCostCents * nonNeg(input.overheadPct)) / 100);
  const totalCostCents = directCostCents + overheadCostCents;

  // 1–3. Floor vs detailed; the higher one wins.
  const floorCents = pricingFloorCents(materialCostCents);
  const margin = finite(input.targetMarginPct) / 100;
  const detailedPriceCents = margin < 1 ? Math.round(totalCostCents / (1 - margin)) : null;
  const basis: "floor" | "detailed" = detailedPriceCents != null && detailedPriceCents > floorCents ? "detailed" : "floor";
  const baseRecommendedCents = basis === "detailed" ? detailedPriceCents! : floorCents;

  // 4. Optional value adjustments (never applied automatically), then round UP.
  const adjustments = input.valueAdjustments.map((a) => ({
    id: a.id,
    label: a.label,
    cents: a.mode === "percent" ? Math.round((baseRecommendedCents * nonNeg(a.value)) / 100) : Math.round(nonNeg(a.value)),
  }));
  const valueAdjustmentCents = adjustments.reduce((s, a) => s + a.cents, 0);
  const adjustedCents = baseRecommendedCents + valueAdjustmentCents;
  const finalRecommendedCents = Math.max(roundUpToDollars(adjustedCents, nonNeg(input.roundToDollars)), floorCents);

  const mlShare = Math.min(Math.max(thresholds.materialsLaborPct, 1), 100) / 100;
  const fiftyCheckCents = Math.round((materialCostCents + laborCostCents) / mlShare);

  // 5. Final selling price
  const manual = input.manualPriceCents != null && input.manualPriceCents > 0 ? input.manualPriceCents : null;
  const finalPriceCents = manual ?? finalRecommendedCents;
  const belowFloor = finalPriceCents < floorCents;

  const grossProfitCents = finalPriceCents - materialCostCents - laborCostCents - otherDirectCostCents;
  const netProfitCents = grossProfitCents - overheadCostCents;
  const profit = {
    sellingPriceCents: finalPriceCents,
    materialCostCents,
    materialsPct: pct(materialCostCents, finalPriceCents),
    laborCostCents,
    otherDirectCostCents,
    grossProfitCents,
    grossMarginPct: pct(grossProfitCents, finalPriceCents),
    overheadCostCents,
    netProfitCents,
    netMarginPct: pct(netProfitCents, finalPriceCents),
    markupPct: pct(finalPriceCents - totalCostCents, totalCostCents),
    laborPct: pct(laborCostCents, finalPriceCents),
    materialsLaborPct: pct(materialCostCents + laborCostCents, finalPriceCents),
  };

  const depositPct = Math.min(nonNeg(input.depositPct), 100);
  const depositCents = Math.round((finalPriceCents * depositPct) / 100);
  const deposit = {
    pct: depositPct,
    depositCents,
    balanceCents: finalPriceCents - depositCents,
    coversMaterials: depositCents >= materialCostCents,
    afterMaterialsCents: depositCents - materialCostCents,
  };

  // Advisory warnings — never blocking.
  const warnings: EstimateWarning[] = [];
  if (margin >= 1) warnings.push({ code: "impossible-margin", level: "danger", message: "A target margin of 100% or more isn't possible. Choose a lower margin." });
  if (belowFloor) warnings.push({ code: "below-floor", level: "danger", message: BELOW_FLOOR_WARNING });
  if (finalPriceCents > 0 && totalCostCents > 0) {
    if (netProfitCents < 0) {
      warnings.push({ code: "loss", level: "danger", message: "This price would produce a projected loss after overhead." });
    } else if (profit.netMarginPct != null && profit.netMarginPct < thresholds.minMarginPct) {
      warnings.push({ code: "low-margin", level: "caution", message: `This price produces less than a ${fmtPct(thresholds.minMarginPct)} projected net margin.` });
    }
    if (profit.materialsLaborPct != null && profit.materialsLaborPct > thresholds.materialsLaborPct) {
      warnings.push({
        code: "materials-labor",
        level: "caution",
        message: `Materials and labor exceed ${fmtPct(thresholds.materialsLaborPct)} of this selling price. Review the quote carefully.`,
      });
    }
  }
  if (laborHours === 0 && materialCostCents > 0) {
    warnings.push({ code: "no-labor", level: "caution", message: "No labor has been entered. Material-only pricing can badly undercharge labor-heavy pieces." });
  }
  if (materialCostCents > 0 && finalPriceCents > 0 && !deposit.coversMaterials) {
    warnings.push({ code: "deposit-short", level: "caution", message: "The deposit does not cover the material cost." });
  }

  return {
    lumber: { lines: lumberLines, boardFeet: lumberLines.reduce((s, l) => s + l.boardFeet, 0), rawCents: lumberRaw, wasteCents: lumberWaste, totalCents: lumberRaw + lumberWaste },
    otherMaterials: { lines: materialLines.map(({ id, totalCents }) => ({ id, totalCents })), rawCents: materialRaw, wasteCents: materialWaste, totalCents: materialRaw + materialWaste },
    materialCostCents,
    suppliesCostCents,
    otherExpensesCents,
    otherDirectCostCents,
    laborHours,
    laborCostCents,
    overheadCostCents,
    totalCostCents,
    pricing: {
      floorCents,
      detailedPriceCents,
      baseRecommendedCents,
      basis,
      adjustments,
      valueAdjustmentCents,
      adjustedCents,
      finalRecommendedCents,
      roundingCents: finalRecommendedCents - adjustedCents,
      fiftyCheckCents,
    },
    finalPriceCents,
    manualPrice: manual != null,
    belowFloor,
    profit,
    deposit,
    warnings,
  };
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const rounded = Number(n.toFixed(digits));
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(digits)}%`;
}

export interface PricingDefaults {
  laborRateCents: number;
  lumberWastePct: number;
  materialWastePct: number;
  overheadPct: number;
  overheadMethod: OverheadMethod;
  monthlyOverheadCents: number;
  projectsPerMonth: number;
  targetMarginPct: number;
  depositPct: number;
  roundToDollars: number;
}

/** Blank inputs filled with the business's saved defaults. */
export function defaultEstimateInputs(defaults: PricingDefaults): EstimateInputs {
  return {
    productType: "",
    dimensions: "",
    woodSpecies: "",
    lumber: [],
    lumberWastePct: defaults.lumberWastePct,
    materials: [],
    materialWastePct: defaults.materialWastePct,
    otherCosts: [],
    laborMode: "simple",
    laborHours: 0,
    laborRateCents: defaults.laborRateCents,
    laborPhases: DEFAULT_LABOR_PHASES.map((name, i) => ({ id: `phase-${i}`, name, hours: 0, rateCents: defaults.laborRateCents })),
    overheadMethod: defaults.overheadMethod,
    overheadPct: defaults.overheadPct,
    monthlyOverheadCents: defaults.monthlyOverheadCents,
    projectsPerMonth: defaults.projectsPerMonth,
    targetMarginPct: defaults.targetMarginPct,
    valueAdjustments: [],
    roundToDollars: defaults.roundToDollars,
    manualPriceCents: null,
    depositPct: defaults.depositPct,
  };
}
