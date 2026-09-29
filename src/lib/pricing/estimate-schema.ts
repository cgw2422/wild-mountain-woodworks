import { z } from "zod";

/** Server-side validation of calculator inputs (mirrors EstimateInputs). */
const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const cents = num(0, 100_000_000).int();
const id = z.string().max(40);
const text = z.string().trim().max(200);

const inputsObject = z.object({
  productType: text.default(""),
  dimensions: text.default(""),
  woodSpecies: text.default(""),
  lumber: z
    .array(
      z.object({
        id,
        description: text,
        thicknessIn: num(0, 48),
        widthIn: num(0, 240),
        lengthFt: num(0, 100),
        quantity: num(0, 10_000),
        pricePerBoardFootCents: cents,
      }),
    )
    .max(100),
  lumberWastePct: num(0, 200),
  materials: z
    .array(z.object({ id, description: text, category: z.enum(["material", "supplies"]).default("material"), quantity: num(0, 100_000), unitCostCents: cents }))
    .max(200),
  materialWastePct: num(0, 200),
  otherCosts: z
    .array(z.object({ id, kind: z.enum(["delivery", "installation", "outsourced", "other"]), description: text, amountCents: cents }))
    .max(50)
    .default([]),
  laborMode: z.enum(["simple", "phases"]),
  laborHours: num(0, 10_000),
  laborRateCents: cents,
  laborPhases: z.array(z.object({ id, name: text, hours: num(0, 10_000), rateCents: cents })).max(30),
  overheadMethod: z.enum(["percent", "allocated"]),
  overheadPct: num(0, 500),
  monthlyOverheadCents: cents,
  projectsPerMonth: num(0, 10_000).int(),
  targetMarginPct: num(0, 99.9),
  valueAdjustments: z
    .array(z.object({ id, label: text, mode: z.enum(["amount", "percent"]), value: num(0, 100_000_000) }))
    .max(30)
    .default([]),
  roundToDollars: num(0, 10_000).default(0),
  manualPriceCents: cents.nullable().default(null),
  depositPct: num(0, 100).default(50),
});

/**
 * Estimates saved before the 30% floor update stored the admin's price as
 * `proposedPriceCents`; it is read as the manual final price.
 */
export const estimateInputsSchema = z.preprocess((raw) => {
  if (raw && typeof raw === "object" && !("manualPriceCents" in raw) && "proposedPriceCents" in raw) {
    const { proposedPriceCents, ...rest } = raw as Record<string, unknown>;
    return { ...rest, manualPriceCents: proposedPriceCents };
  }
  return raw;
}, inputsObject);

export const estimateMetaSchema = z.object({
  name: z.string().trim().min(1, "Give this estimate a name.").max(160),
  customerName: z.string().trim().max(120).transform((v) => v || null),
  customerEmail: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), "Enter a valid email address.")
    .transform((v) => v || null),
  customerPhone: z.string().trim().max(30).transform((v) => v || null),
  customerZip: z.string().trim().max(10).transform((v) => v || null),
  productId: z.string().max(40).transform((v) => v || null),
  notes: z.string().trim().max(5000).transform((v) => v || null),
});
