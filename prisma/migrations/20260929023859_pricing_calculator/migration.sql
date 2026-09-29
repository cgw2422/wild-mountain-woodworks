-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "estLaborHours" DOUBLE PRECISION,
ADD COLUMN     "estMaterialCostCents" INTEGER;

-- AlterTable
ALTER TABLE "SiteSetting" ADD COLUMN     "pricingLaborRateCents" INTEGER NOT NULL DEFAULT 4500,
ADD COLUMN     "pricingLumberWastePct" DOUBLE PRECISION NOT NULL DEFAULT 15,
ADD COLUMN     "pricingMaterialWastePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "pricingMaterialsLaborWarnPct" DOUBLE PRECISION NOT NULL DEFAULT 50,
ADD COLUMN     "pricingMinMarginWarnPct" DOUBLE PRECISION NOT NULL DEFAULT 25,
ADD COLUMN     "pricingMonthlyOverheadCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pricingOverheadMethod" TEXT NOT NULL DEFAULT 'percent',
ADD COLUMN     "pricingOverheadPct" DOUBLE PRECISION NOT NULL DEFAULT 5,
ADD COLUMN     "pricingProjectsPerMonth" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "pricingTargetMarginPct" DOUBLE PRECISION NOT NULL DEFAULT 35;

-- CreateTable
CREATE TABLE "PriceEstimate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "customerZip" TEXT,
    "productId" TEXT,
    "quoteRequestId" TEXT,
    "inputs" JSONB NOT NULL,
    "materialCostCents" INTEGER NOT NULL,
    "laborCostCents" INTEGER NOT NULL,
    "overheadCostCents" INTEGER NOT NULL,
    "totalCostCents" INTEGER NOT NULL,
    "targetMarginPct" DOUBLE PRECISION NOT NULL,
    "materialsCheckCents" INTEGER NOT NULL,
    "fiftyCheckCents" INTEGER NOT NULL,
    "fullCostPriceCents" INTEGER,
    "finalPriceCents" INTEGER,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceEstimate_archivedAt_updatedAt_idx" ON "PriceEstimate"("archivedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "PriceEstimate_productId_idx" ON "PriceEstimate"("productId");

-- AddForeignKey
ALTER TABLE "PriceEstimate" ADD CONSTRAINT "PriceEstimate_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceEstimate" ADD CONSTRAINT "PriceEstimate_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceEstimate" ADD CONSTRAINT "PriceEstimate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
