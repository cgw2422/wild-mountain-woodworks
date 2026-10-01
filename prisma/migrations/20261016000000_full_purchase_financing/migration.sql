-- Two ways to proceed after accepting a quote: the standard deposit (Affirm and
-- Klarna excluded from that Checkout), or full-purchase financing (the whole
-- order total in one Checkout where Affirm/Klarna may appear when eligible).
ALTER TYPE "PaymentType" ADD VALUE 'FULL_PURCHASE' BEFORE 'OTHER';

ALTER TABLE "Payment" ADD COLUMN "stripePaymentMethodType" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "stripeCheckoutPurpose" TEXT;

-- Wording defaults: financing is for the full purchase; the ordinary-methods
-- line no longer lists Affirm/Klarna. Only untouched defaults are changed.
ALTER TABLE "SiteSetting" ALTER COLUMN "paymentMessagingHeading" SET DEFAULT 'Flexible financing available';
ALTER TABLE "SiteSetting" ALTER COLUMN "paymentMethodsText" SET DEFAULT 'Card · Bank · Apple Pay · Link · Cash App Pay · Amazon Pay';
UPDATE "SiteSetting" SET "paymentMessagingHeading" = 'Flexible financing available' WHERE "paymentMessagingHeading" = 'Flexible payment options available';
UPDATE "SiteSetting" SET "paymentMethodsText" = 'Card · Bank · Apple Pay · Link · Cash App Pay · Amazon Pay' WHERE "paymentMethodsText" = 'Card · Bank · Apple Pay · Link · Cash App Pay · Amazon Pay · Affirm · Klarna';
