/**
 * Internal pricing calculator (admin decision-support only).
 *
 * Pure and framework-free: the admin UI uses it for live results and the
 * server re-runs it when an estimate is saved. Money is integer cents,
 * percentages are plain numbers (35 = 35%).
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

export interface MaterialLine {
  id: string;
  description: string;
  quantity: number;
  unitCostCents: number;
}

export interface LaborPhase {
  id: string;
  name: string;
  hours: number;
  rateCents: number;
}

export type OverheadMethod = "percent" | "allocated";
export type LaborMode = "simple" | "phases";

export interface EstimateInputs {
  lumber: LumberLine[];
  lumberWastePct: number;
  materials: MaterialLine[];
  materialWastePct: number;
  laborMode: LaborMode;
  laborHours: number;
  laborRateCents: number;
  laborPhases: LaborPhase[];
  overheadMethod: OverheadMethod;
  /** Percent of materials + labor. */
  overheadPct: number;
  monthlyOverheadCents: number;
  projectsPerMonth: number;
  targetMarginPct: number;
  /** The admin's own proposed selling price, if entered. */
  proposedPriceCents: number | null;
}

export interface EstimateThresholds {
  minMarginPct: number; // warn below this projected margin (default 25)
  materialsLaborPct: number; // warn when materials + labor exceed this share of price (default 50)
}

/** Divisor for the quick "materials ÷ 0.30" price check. */
export const MATERIALS_SHORTCUT_RATIO = 0.3;

export const MARGIN_PRESETS = [25, 30, 35, 40, 45] as const;

export const DEFAULT_LABOR_PHASES = ["Design", "Milling", "Cutting", "Assembly", "Sanding", "Finishing", "Delivery/install"] as const;

/** Board feet for one piece: thickness (in) × width (in) × length (ft) ÷ 12. */
export function boardFeet(thicknessIn: number, widthIn: number, lengthFt: number): number {
  return (thicknessIn * widthIn * lengthFt) / 12;
}

const finite = (n: number) => (Number.isFinite(n) ? n : 0);
const nonNeg = (n: number) => Math.max(0, finite(n));
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

export interface EstimateWarning {
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
    rawCents: number;
    wasteCents: number;
    totalCents: number;
  };
  materialCostCents: number;
  laborHours: number;
  laborCostCents: number;
  overheadCostCents: number;
  totalCostCents: number;
  methods: {
    /** Materials ÷ 0.30 */
    materialsCheckCents: number;
    /** (Materials + labor) ÷ threshold (default 50%) */
    fiftyCheckCents: number;
    /** Total cost ÷ (1 − target margin); null when the margin is ≥ 100%. */
    fullCostPriceCents: number | null;
  };
  /** Analysis of the proposed price (or the full-cost price when none entered). */
  analysis: {
    priceCents: number;
    source: "proposed" | "full-cost";
    profitCents: number;
    marginPct: number | null;
    markupPct: number | null;
    materialsPct: number | null;
    laborPct: number | null;
    overheadPct: number | null;
    materialsLaborPct: number | null;
  } | null;
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

  // Other material line items + optional waste
  const materialLines = input.materials.map((m) => ({ id: m.id, totalCents: Math.round(nonNeg(m.quantity) * nonNeg(m.unitCostCents)) }));
  const otherRaw = materialLines.reduce((s, m) => s + m.totalCents, 0);
  const otherWaste = Math.round((otherRaw * nonNeg(input.materialWastePct)) / 100);

  const materialCostCents = lumberRaw + lumberWaste + otherRaw + otherWaste;

  // Labor
  let laborHours: number;
  let laborCostCents: number;
  if (input.laborMode === "phases") {
    laborHours = input.laborPhases.reduce((s, p) => s + nonNeg(p.hours), 0);
    laborCostCents = input.laborPhases.reduce((s, p) => s + Math.round(nonNeg(p.hours) * nonNeg(p.rateCents)), 0);
  } else {
    laborHours = nonNeg(input.laborHours);
    laborCostCents = Math.round(laborHours * nonNeg(input.laborRateCents));
  }

  // Overhead
  const overheadCostCents =
    input.overheadMethod === "allocated"
      ? input.projectsPerMonth > 0
        ? Math.round(nonNeg(input.monthlyOverheadCents) / input.projectsPerMonth)
        : 0
      : Math.round(((materialCostCents + laborCostCents) * nonNeg(input.overheadPct)) / 100);

  const totalCostCents = materialCostCents + laborCostCents + overheadCostCents;

  // Pricing methods
  const materialsCheckCents = Math.round(materialCostCents / MATERIALS_SHORTCUT_RATIO);
  const mlShare = Math.min(Math.max(thresholds.materialsLaborPct, 1), 100) / 100;
  const fiftyCheckCents = Math.round((materialCostCents + laborCostCents) / mlShare);
  const margin = finite(input.targetMarginPct) / 100;
  const fullCostPriceCents = margin < 1 ? Math.round(totalCostCents / (1 - margin)) : null;

  // Analysis
  const proposed = input.proposedPriceCents != null && input.proposedPriceCents > 0 ? input.proposedPriceCents : null;
  const priceCents = proposed ?? fullCostPriceCents;
  const analysis =
    priceCents != null
      ? {
          priceCents,
          source: (proposed != null ? "proposed" : "full-cost") as "proposed" | "full-cost",
          profitCents: priceCents - totalCostCents,
          marginPct: pct(priceCents - totalCostCents, priceCents),
          markupPct: pct(priceCents - totalCostCents, totalCostCents),
          materialsPct: pct(materialCostCents, priceCents),
          laborPct: pct(laborCostCents, priceCents),
          overheadPct: pct(overheadCostCents, priceCents),
          materialsLaborPct: pct(materialCostCents + laborCostCents, priceCents),
        }
      : null;

  // Advisory warnings — never blocking.
  const warnings: EstimateWarning[] = [];
  if (margin >= 1) warnings.push({ level: "danger", message: "A target margin of 100% or more isn't possible. Choose a lower margin." });
  if (analysis && totalCostCents > 0) {
    if (analysis.profitCents < 0) {
      warnings.push({ level: "danger", message: "This price would produce a projected loss." });
    } else if (analysis.marginPct != null && analysis.marginPct < thresholds.minMarginPct) {
      warnings.push({ level: "caution", message: `This price produces less than a ${fmtPct(thresholds.minMarginPct)} projected margin.` });
    }
    if (analysis.materialsLaborPct != null && analysis.materialsLaborPct > thresholds.materialsLaborPct) {
      warnings.push({
        level: "caution",
        message: `Materials and labor exceed ${fmtPct(thresholds.materialsLaborPct)} of this selling price. Review the quote carefully.`,
      });
    }
  }
  if (laborHours === 0 && materialCostCents > 0) {
    warnings.push({ level: "caution", message: "No labor has been entered. Material-only pricing can badly undercharge labor-heavy pieces." });
  }

  return {
    lumber: { lines: lumberLines, boardFeet: lumberLines.reduce((s, l) => s + l.boardFeet, 0), rawCents: lumberRaw, wasteCents: lumberWaste, totalCents: lumberRaw + lumberWaste },
    otherMaterials: { lines: materialLines, rawCents: otherRaw, wasteCents: otherWaste, totalCents: otherRaw + otherWaste },
    materialCostCents,
    laborHours,
    laborCostCents,
    overheadCostCents,
    totalCostCents,
    methods: { materialsCheckCents, fiftyCheckCents, fullCostPriceCents },
    analysis,
    warnings,
  };
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const rounded = Number(n.toFixed(digits));
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(digits)}%`;
}

/** Blank inputs filled with the business's saved defaults. */
export function defaultEstimateInputs(defaults: {
  laborRateCents: number;
  lumberWastePct: number;
  materialWastePct: number;
  overheadPct: number;
  overheadMethod: OverheadMethod;
  monthlyOverheadCents: number;
  projectsPerMonth: number;
  targetMarginPct: number;
}): EstimateInputs {
  return {
    lumber: [],
    lumberWastePct: defaults.lumberWastePct,
    materials: [],
    materialWastePct: defaults.materialWastePct,
    laborMode: "simple",
    laborHours: 0,
    laborRateCents: defaults.laborRateCents,
    laborPhases: DEFAULT_LABOR_PHASES.map((name, i) => ({ id: `phase-${i}`, name, hours: 0, rateCents: defaults.laborRateCents })),
    overheadMethod: defaults.overheadMethod,
    overheadPct: defaults.overheadPct,
    monthlyOverheadCents: defaults.monthlyOverheadCents,
    projectsPerMonth: defaults.projectsPerMonth,
    targetMarginPct: defaults.targetMarginPct,
    proposedPriceCents: null,
  };
}
