-- Deposit payment through Stripe Checkout at quote acceptance (additive only).
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "checkoutAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stripeCheckoutExpiresAt" TIMESTAMP(3),
ADD COLUMN     "stripeCheckoutSessionId" TEXT,
ADD COLUMN     "stripeCheckoutStatus" TEXT,
ADD COLUMN     "stripeCheckoutUrl" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "stripeCheckoutSessionId" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_stripeCheckoutSessionId_idx" ON "Invoice"("stripeCheckoutSessionId");

