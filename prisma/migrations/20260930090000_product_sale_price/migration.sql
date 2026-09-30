-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "saleEndsAt" TIMESTAMP(3),
ADD COLUMN     "salePriceCents" INTEGER,
ADD COLUMN     "saleStartsAt" TIMESTAMP(3);
