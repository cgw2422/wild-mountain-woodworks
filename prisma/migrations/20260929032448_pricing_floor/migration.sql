-- 30% material-cost pricing floor: rename the old quick-check columns and
-- store the full pricing breakdown on each saved estimate.

-- "Materials ÷ 0.30" is now the pricing floor; "full cost + margin" is the detailed price.
ALTER TABLE "PriceEstimate" RENAME COLUMN "materialsCheckCents" TO "floorCents";
ALTER TABLE "PriceEstimate" RENAME COLUMN "fullCostPriceCents" TO "detailedPriceCents";

ALTER TABLE "PriceEstimate"
ADD COLUMN     "productType" TEXT,
ADD COLUMN     "dimensions" TEXT,
ADD COLUMN     "woodSpecies" TEXT,
ADD COLUMN     "suppliesCostCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "otherDirectCostCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "laborHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "baseRecommendedCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "valueAdjustmentCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "finalRecommendedCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "manualPrice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "depositPct" DOUBLE PRECISION NOT NULL DEFAULT 50,
ADD COLUMN     "depositCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "balanceCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "grossProfitCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "grossMarginPct" DOUBLE PRECISION,
ADD COLUMN     "netProfitCents" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing estimates: the recommendation is MAX(floor, detailed);
-- a previously entered proposed price becomes the manual final price.
UPDATE "PriceEstimate" SET
  "baseRecommendedCents" = GREATEST("floorCents", COALESCE("detailedPriceCents", 0)),
  "finalRecommendedCents" = GREATEST("floorCents", COALESCE("detailedPriceCents", 0)),
  "manualPrice" = "finalPriceCents" IS NOT NULL,
  "finalPriceCents" = COALESCE("finalPriceCents", GREATEST("floorCents", COALESCE("detailedPriceCents", 0)));

UPDATE "PriceEstimate" SET
  "depositCents" = ROUND("finalPriceCents" * 0.5),
  "balanceCents" = "finalPriceCents" - ROUND("finalPriceCents" * 0.5),
  "grossProfitCents" = "finalPriceCents" - "materialCostCents" - "laborCostCents",
  "grossMarginPct" = CASE WHEN "finalPriceCents" > 0 THEN ("finalPriceCents" - "materialCostCents" - "laborCostCents") * 100.0 / "finalPriceCents" END,
  "netProfitCents" = "finalPriceCents" - "totalCostCents";

ALTER TABLE "SiteSetting"
ADD COLUMN     "pricingDepositPct" DOUBLE PRECISION NOT NULL DEFAULT 50,
ADD COLUMN     "pricingRoundToDollars" INTEGER NOT NULL DEFAULT 50;
