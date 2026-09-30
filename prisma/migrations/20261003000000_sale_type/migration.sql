-- CreateEnum
CREATE TYPE "SaleType" AS ENUM ('PERCENT', 'FIXED_PRICE');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "salePercentBps" INTEGER,
ADD COLUMN     "saleType" "SaleType";


-- Every existing sale was stored as a sale price.
UPDATE "Product" SET "saleType" = 'FIXED_PRICE' WHERE "salePriceCents" IS NOT NULL;
