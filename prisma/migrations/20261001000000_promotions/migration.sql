-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "saleEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "saleLabel" TEXT;

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT NOT NULL,
    "secondaryText" TEXT,
    "linkText" TEXT,
    "linkUrl" TEXT,
    "backgroundColor" TEXT NOT NULL DEFAULT '#1f1e1c',
    "textColor" TEXT NOT NULL DEFAULT '#f7f3ec',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "showEndDate" BOOLEAN NOT NULL DEFAULT true,
    "dismissible" BOOLEAN NOT NULL DEFAULT true,
    "showOnDesktop" BOOLEAN NOT NULL DEFAULT true,
    "showOnMobile" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Announcement_enabled_startsAt_endsAt_idx" ON "Announcement"("enabled", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Product_saleEnabled_saleStartsAt_saleEndsAt_idx" ON "Product"("saleEnabled", "saleStartsAt", "saleEndsAt");


-- Existing sale prices were live without a toggle: keep them running.
UPDATE "Product" SET "saleEnabled" = true WHERE "salePriceCents" IS NOT NULL;
