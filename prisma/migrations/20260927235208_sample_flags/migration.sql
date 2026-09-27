-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "isSample" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PortfolioProject" ADD COLUMN     "isSample" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isSample" BOOLEAN NOT NULL DEFAULT false;
