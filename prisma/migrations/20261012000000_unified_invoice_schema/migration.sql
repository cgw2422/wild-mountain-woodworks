-- Unified invoice / payment / production-status model (schema part).
-- Hand-written: enums are renamed or rebuilt with an explicit mapping so no
-- value or history is lost. Data remapping that needs the new enum values is
-- in the next migration (20261012000100_unified_invoice_data).

-- Invoice status: VOID is now VOIDED; deposit/balance-due states added.
ALTER TYPE "InvoiceStatus" RENAME VALUE 'VOID' TO 'VOIDED';
ALTER TYPE "InvoiceStatus" ADD VALUE 'DEPOSIT_DUE' AFTER 'OPEN';
ALTER TYPE "InvoiceStatus" ADD VALUE 'BALANCE_DUE' AFTER 'PARTIALLY_PAID';

-- Order payment status: balance requested, voided.
ALTER TYPE "OrderPaymentStatus" ADD VALUE 'BALANCE_DUE' AFTER 'PARTIALLY_PAID';
ALTER TYPE "OrderPaymentStatus" ADD VALUE 'VOIDED';

-- Payment method: Stripe Checkout payments become STRIPE_ONLINE; in-person Terminal added.
ALTER TYPE "PaymentMethod" RENAME VALUE 'STRIPE' TO 'STRIPE_ONLINE';
ALTER TYPE "PaymentMethod" ADD VALUE 'STRIPE_TERMINAL' AFTER 'STRIPE_ONLINE';

-- Payment status: bounced checks.
ALTER TYPE "PaymentRecordStatus" ADD VALUE 'RETURNED';

-- Payment purpose, separate from method.
CREATE TYPE "PaymentType" AS ENUM ('DEPOSIT', 'FINAL_BALANCE', 'PARTIAL_PAYMENT', 'ADDITIONAL_PAYMENT', 'OTHER');

ALTER TABLE "Payment"
  ADD COLUMN "type" "PaymentType" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "payerName" TEXT,
  ADD COLUMN "receivedBy" TEXT,
  ADD COLUMN "clearedAt" TIMESTAMP(3),
  ADD COLUMN "returnedAt" TIMESTAMP(3),
  ADD COLUMN "stripeTerminalReaderId" TEXT,
  ADD COLUMN "failureMessage" TEXT,
  ADD COLUMN "overpaymentApprovedById" TEXT;

ALTER TABLE "Invoice"
  ADD COLUMN "pendingCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "depositCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "balanceDueAt" TIMESTAMP(3),
  ADD COLUMN "balanceRequestedById" TEXT;

ALTER TABLE "Order"
  ADD COLUMN "deliveryWindow" TEXT,
  ADD COLUMN "deliveryMethod" TEXT;

ALTER TABLE "SiteSetting"
  ADD COLUMN "terminalReaderId" TEXT,
  ADD COLUMN "terminalReaderLabel" TEXT;

CREATE TABLE "StatusNotification" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "customerId" TEXT,
  "email" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "emailLogId" TEXT,
  "initiatedById" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StatusNotification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StatusNotification_orderId_createdAt_idx" ON "StatusNotification"("orderId", "createdAt");
ALTER TABLE "StatusNotification" ADD CONSTRAINT "StatusNotification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Notification history is permanent too.
CREATE TRIGGER wm_no_delete BEFORE DELETE ON "StatusNotification" FOR EACH ROW EXECUTE FUNCTION wm_prevent_delete();

-- Production status: rebuild the enum with the simplified stages.
-- Postgres can't run a subquery inside ALTER COLUMN ... USING, so map into a
-- new column (QUOTE_ACCEPTED depends on whether the deposit is still owed).
CREATE TYPE "ProductionStatus_new" AS ENUM ('AWAITING_DEPOSIT', 'ORDER_CONFIRMED', 'IN_PRODUCTION', 'READY_FOR_DELIVERY', 'DELIVERY_SCHEDULED', 'COMPLETED', 'CANCELED');
ALTER TABLE "Order" ADD COLUMN "productionStatus_new" "ProductionStatus_new";
UPDATE "Order" o SET "productionStatus_new" = (
  CASE o."productionStatus"::text
    WHEN 'QUOTE_ACCEPTED' THEN
      CASE WHEN o."depositCents" > 0 AND COALESCE((
        SELECT SUM(GREATEST(p."amountCents" - p."refundedCents", 0)) FROM "Payment" p
        WHERE p."orderId" = o."id" AND p."status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED')
      ), 0) < o."depositCents" THEN 'AWAITING_DEPOSIT' ELSE 'ORDER_CONFIRMED' END
    WHEN 'AWAITING_DEPOSIT' THEN 'AWAITING_DEPOSIT'
    WHEN 'DEPOSIT_PAID' THEN 'ORDER_CONFIRMED'
    WHEN 'DESIGN_CONFIRMATION' THEN 'ORDER_CONFIRMED'
    WHEN 'MATERIALS_ORDERED' THEN 'IN_PRODUCTION'
    WHEN 'MATERIALS_READY' THEN 'IN_PRODUCTION'
    WHEN 'IN_PRODUCTION' THEN 'IN_PRODUCTION'
    WHEN 'SANDING' THEN 'IN_PRODUCTION'
    WHEN 'FINISHING' THEN 'IN_PRODUCTION'
    WHEN 'CURING' THEN 'IN_PRODUCTION'
    WHEN 'READY_FOR_DELIVERY' THEN 'READY_FOR_DELIVERY'
    WHEN 'DELIVERY_SCHEDULED' THEN 'DELIVERY_SCHEDULED'
    WHEN 'COMPLETED' THEN 'COMPLETED'
    WHEN 'CANCELED' THEN 'CANCELED'
  END
)::"ProductionStatus_new";
-- Keep a visible trace of every remapped order (existing history rows keep their original values).
INSERT INTO "StatusEvent" ("id", "fromStatus", "toStatus", "orderId", "createdAt")
SELECT 'mig_' || md5(o."id" || o."productionStatus"::text), o."productionStatus"::text, o."productionStatus_new"::text, o."id", CURRENT_TIMESTAMP
FROM "Order" o WHERE o."productionStatus"::text <> o."productionStatus_new"::text;
DROP INDEX IF EXISTS "Order_productionStatus_createdAt_idx";
ALTER TABLE "Order" DROP COLUMN "productionStatus";
ALTER TABLE "Order" RENAME COLUMN "productionStatus_new" TO "productionStatus";
ALTER TABLE "Order" ALTER COLUMN "productionStatus" SET NOT NULL, ALTER COLUMN "productionStatus" SET DEFAULT 'AWAITING_DEPOSIT';
DROP TYPE "ProductionStatus";
ALTER TYPE "ProductionStatus_new" RENAME TO "ProductionStatus";
CREATE INDEX "Order_productionStatus_createdAt_idx" ON "Order"("productionStatus", "createdAt");
