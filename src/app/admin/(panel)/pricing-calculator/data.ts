import "server-only";
import { prisma } from "@/lib/db";
import { defaultEstimateInputs } from "@/lib/pricing/estimator";
import { pricingDefaults, pricingThresholds } from "@/lib/pricing/defaults";
import { getSettings } from "@/lib/settings";

export async function loadCalculatorContext() {
  const settings = await getSettings();
  const products = await prisma.product.findMany({
    where: { status: { not: "ARCHIVED" } },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: { id: true, name: true, status: true, basePriceCents: true, estMaterialCostCents: true, estLaborHours: true },
  });
  return {
    defaults: defaultEstimateInputs(pricingDefaults(settings)),
    thresholds: pricingThresholds(settings),
    products,
  };
}
