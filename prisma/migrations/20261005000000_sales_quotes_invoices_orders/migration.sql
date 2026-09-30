-- Quote → invoice → order sales architecture (no cart/checkout, no Stripe Quotes).
-- Hand-edited from `prisma migrate diff` so existing quote requests, orders and
-- settings are preserved: enum values are mapped, not cast blindly, and
-- "ecommerceEnabled" is renamed rather than dropped.

-- AlterEnum
ALTER TYPE "QuoteSource" ADD VALUE 'MANUAL';
ALTER TYPE "QuoteSource" ADD VALUE 'ESTIMATE';

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('DRAFT', 'SENT', 'SUPERSEDED', 'ACCEPTED', 'DECLINED');
CREATE TYPE "DepositType" AS ENUM ('NONE', 'PERCENTAGE', 'FIXED_AMOUNT');
CREATE TYPE "LineItemKind" AS ENUM ('PRODUCT', 'ADDON', 'CUSTOM', 'DISCOUNT', 'DELIVERY', 'INSTALLATION', 'FEE');
CREATE TYPE "OrderPaymentStatus" AS ENUM ('UNPAID', 'DEPOSIT_DUE', 'PARTIALLY_PAID', 'PAID', 'REFUNDED', 'CANCELED');
CREATE TYPE "DeliveryStatus" AS ENUM ('NOT_SCHEDULED', 'SCHEDULED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PICKUP_READY', 'PICKED_UP');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'OPEN', 'PARTIALLY_PAID', 'PAID', 'PAST_DUE', 'VOID', 'CANCELED');
CREATE TYPE "InvoiceKind" AS ENUM ('DEPOSIT', 'BALANCE', 'FULL', 'CUSTOM');
CREATE TYPE "PaymentMethod" AS ENUM ('STRIPE', 'CASH', 'CHECK', 'BANK_TRANSFER', 'OTHER');
CREATE TYPE "PaymentSource" AS ENUM ('STRIPE', 'MANUAL');
CREATE TYPE "PaymentRecordStatus" AS ENUM ('SUCCEEDED', 'PENDING', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'VOIDED');
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- QuoteStatus: CONTACTED → REVIEWING, QUOTED → SENT; other values keep their names.
CREATE TYPE "QuoteStatus_new" AS ENUM ('NEW', 'REVIEWING', 'DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CONVERTED_TO_INVOICE', 'CANCELED', 'COMPLETED');
ALTER TABLE "QuoteRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "QuoteRequest" ALTER COLUMN "status" TYPE "QuoteStatus_new" USING (
  CASE "status"::text
    WHEN 'CONTACTED' THEN 'REVIEWING'
    WHEN 'QUOTED' THEN 'SENT'
    ELSE "status"::text
  END::"QuoteStatus_new"
);
ALTER TYPE "QuoteStatus" RENAME TO "QuoteStatus_old";
ALTER TYPE "QuoteStatus_new" RENAME TO "QuoteStatus";
DROP TYPE "QuoteStatus_old";
ALTER TABLE "QuoteRequest" ALTER COLUMN "status" SET DEFAULT 'NEW';

-- Order: old order status + production status fold into the new production
-- status; old payment status maps into the new payment status.
ALTER TABLE "Order" ADD COLUMN "paymentStatus_new" "OrderPaymentStatus" NOT NULL DEFAULT 'UNPAID';
UPDATE "Order" SET "paymentStatus_new" = (
  CASE "paymentStatus"::text
    WHEN 'PAID' THEN 'PAID'
    WHEN 'PARTIALLY_REFUNDED' THEN 'PAID'
    WHEN 'REFUNDED' THEN 'REFUNDED'
    ELSE 'UNPAID'
  END::"OrderPaymentStatus"
);

CREATE TYPE "ProductionStatus_new" AS ENUM ('QUOTE_ACCEPTED', 'AWAITING_DEPOSIT', 'DEPOSIT_PAID', 'DESIGN_CONFIRMATION', 'MATERIALS_ORDERED', 'MATERIALS_READY', 'IN_PRODUCTION', 'SANDING', 'FINISHING', 'CURING', 'READY_FOR_DELIVERY', 'DELIVERY_SCHEDULED', 'COMPLETED', 'CANCELED');
ALTER TABLE "Order" ALTER COLUMN "productionStatus" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "productionStatus" TYPE "ProductionStatus_new" USING (
  CASE
    WHEN "status"::text = 'CANCELLED' THEN 'CANCELED'
    WHEN "productionStatus"::text = 'ORDER_RECEIVED' THEN 'QUOTE_ACCEPTED'
    WHEN "productionStatus"::text = 'MATERIALS_PREPARED' THEN 'MATERIALS_READY'
    ELSE "productionStatus"::text
  END::"ProductionStatus_new"
);
ALTER TYPE "ProductionStatus" RENAME TO "ProductionStatus_old";
ALTER TYPE "ProductionStatus_new" RENAME TO "ProductionStatus";
DROP TYPE "ProductionStatus_old";
ALTER TABLE "Order" ALTER COLUMN "productionStatus" SET DEFAULT 'QUOTE_ACCEPTED';

DROP INDEX "Order_status_createdAt_idx";
ALTER TABLE "Order" DROP COLUMN "status";
ALTER TABLE "Order" DROP COLUMN "paymentStatus";
ALTER TABLE "Order" RENAME COLUMN "paymentStatus_new" TO "paymentStatus";
DROP TYPE "OrderStatus";
DROP TYPE "PaymentStatus";

ALTER TABLE "Order" ADD COLUMN     "acceptedRevisionId" TEXT,
ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "customerToken" TEXT,
ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryDate" TIMESTAMP(3),
ADD COLUMN     "deliveryNotes" TEXT,
ADD COLUMN     "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'NOT_SCHEDULED',
ADD COLUMN     "depositCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "estimatedCompletion" TEXT,
ADD COLUMN     "productionNotes" TEXT,
ADD COLUMN     "quoteId" TEXT;

-- AlterTable
ALTER TABLE "InternalNote" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "invoiceId" TEXT;

ALTER TABLE "OrderItem" ADD COLUMN     "description" TEXT,
ADD COLUMN     "kind" "LineItemKind" NOT NULL DEFAULT 'PRODUCT',
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "QuoteRequest" ADD COLUMN     "acceptedRevisionId" TEXT,
ADD COLUMN     "address" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "currentRevisionId" TEXT,
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "customerToken" TEXT,
ADD COLUMN     "number" TEXT,
ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1;

-- The cart/checkout flag becomes the Stripe invoicing flag (value kept; it
-- was never enabled in production).
ALTER TABLE "SiteSetting" RENAME COLUMN "ecommerceEnabled" TO "stripeInvoicingEnabled";
ALTER TABLE "SiteSetting" ADD COLUMN     "defaultDepositAmountCents" INTEGER,
ADD COLUMN     "defaultDepositPercentBps" INTEGER NOT NULL DEFAULT 5000,
ADD COLUMN     "defaultDepositType" "DepositType" NOT NULL DEFAULT 'PERCENTAGE',
ADD COLUMN     "defaultQuoteTerms" TEXT,
ADD COLUMN     "paymentInstructions" TEXT,
ADD COLUMN     "invoiceDueDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "invoiceEmailMode" TEXT NOT NULL DEFAULT 'WILD_MOUNTAIN',
ADD COLUMN     "quoteAlertDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "quoteValidDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "taxEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "StatusEvent" ADD COLUMN     "invoiceId" TEXT;

-- CreateTable
CREATE TABLE "QuoteRevision" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerAddress" TEXT,
    "customerNotes" TEXT,
    "terms" TEXT,
    "expiresAt" TIMESTAMP(3),
    "leadTime" TEXT,
    "estimatedCompletion" TEXT,
    "deliveryDetails" TEXT,
    "depositType" "DepositType" NOT NULL DEFAULT 'NONE',
    "depositPercentBps" INTEGER,
    "depositAmountCents" INTEGER,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "deliveryCents" INTEGER NOT NULL DEFAULT 0,
    "otherChargesCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedName" TEXT,
    "acceptedIp" TEXT,
    "acceptedUserAgent" TEXT,
    "acceptedSnapshot" JSONB,
    "acceptedManuallyById" TEXT,
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLineItem" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "LineItemKind" NOT NULL DEFAULT 'CUSTOM',
    "description" TEXT NOT NULL,
    "notes" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "lineTotalCents" INTEGER NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "productId" TEXT,
    "configuration" JSONB,

    CONSTRAINT "QuoteLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "zipCode" TEXT,
    "billingAddress" TEXT,
    "deliveryAddress" TEXT,
    "stripeCustomerId" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerActivity" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "quoteId" TEXT,
    "invoiceId" TEXT,
    "orderId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "InvoiceKind" NOT NULL DEFAULT 'FULL',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "customerId" TEXT,
    "quoteId" TEXT,
    "revisionId" TEXT,
    "orderId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "deliveryCents" INTEGER NOT NULL DEFAULT 0,
    "otherChargesCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "customerNotes" TEXT,
    "publicToken" TEXT,
    "stripeInvoiceId" TEXT,
    "stripeHostedInvoiceUrl" TEXT,
    "stripeInvoicePdfUrl" TEXT,
    "stripeStatus" TEXT,
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "LineItemKind" NOT NULL DEFAULT 'CUSTOM',
    "description" TEXT NOT NULL,
    "notes" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "lineTotalCents" INTEGER NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT,
    "orderId" TEXT,
    "customerId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "method" "PaymentMethod" NOT NULL,
    "source" "PaymentSource" NOT NULL,
    "status" "PaymentRecordStatus" NOT NULL DEFAULT 'SUCCEEDED',
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "stripeInvoiceId" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "buttonLabel" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "customerId" TEXT,
    "quoteId" TEXT,
    "invoiceId" TEXT,
    "orderId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesAttachment" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "quoteId" TEXT,
    "orderId" TEXT,
    "label" TEXT,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRevision_quoteId_number_key" ON "QuoteRevision"("quoteId", "number");

-- CreateIndex
CREATE INDEX "QuoteLineItem_revisionId_position_idx" ON "QuoteLineItem"("revisionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_stripeCustomerId_key" ON "Customer"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "Customer_lastActivityAt_idx" ON "Customer"("lastActivityAt");

-- CreateIndex
CREATE INDEX "CustomerActivity_customerId_createdAt_idx" ON "CustomerActivity"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_publicToken_key" ON "Invoice"("publicToken");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_stripeInvoiceId_key" ON "Invoice"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_quoteId_idx" ON "Invoice"("quoteId");

-- CreateIndex
CREATE INDEX "Invoice_orderId_idx" ON "Invoice"("orderId");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_invoiceId_position_idx" ON "InvoiceLineItem"("invoiceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_customerId_idx" ON "Payment"("customerId");

-- CreateIndex
CREATE INDEX "Payment_receivedAt_idx" ON "Payment"("receivedAt");

-- CreateIndex
CREATE INDEX "EmailLog_status_createdAt_idx" ON "EmailLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EmailLog_quoteId_idx" ON "EmailLog"("quoteId");

-- CreateIndex
CREATE INDEX "EmailLog_invoiceId_idx" ON "EmailLog"("invoiceId");

-- CreateIndex
CREATE INDEX "EmailLog_orderId_idx" ON "EmailLog"("orderId");

-- CreateIndex
CREATE INDEX "SalesAttachment_quoteId_idx" ON "SalesAttachment"("quoteId");

-- CreateIndex
CREATE INDEX "SalesAttachment_orderId_idx" ON "SalesAttachment"("orderId");

-- CreateIndex
CREATE INDEX "InternalNote_customerId_idx" ON "InternalNote"("customerId");

-- CreateIndex
CREATE INDEX "InternalNote_invoiceId_idx" ON "InternalNote"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_customerToken_key" ON "Order"("customerToken");

-- CreateIndex
CREATE INDEX "Order_productionStatus_createdAt_idx" ON "Order"("productionStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Order_paymentStatus_idx" ON "Order"("paymentStatus");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequest_number_key" ON "QuoteRequest"("number");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequest_customerToken_key" ON "QuoteRequest"("customerToken");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequest_currentRevisionId_key" ON "QuoteRequest"("currentRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequest_acceptedRevisionId_key" ON "QuoteRequest"("acceptedRevisionId");

-- CreateIndex
CREATE INDEX "QuoteRequest_customerId_idx" ON "QuoteRequest"("customerId");

-- CreateIndex
CREATE INDEX "StatusEvent_invoiceId_idx" ON "StatusEvent"("invoiceId");

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "QuoteRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_acceptedRevisionId_fkey" FOREIGN KEY ("acceptedRevisionId") REFERENCES "QuoteRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRevision" ADD CONSTRAINT "QuoteRevision_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusEvent" ADD CONSTRAINT "StatusEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "QuoteRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_acceptedRevisionId_fkey" FOREIGN KEY ("acceptedRevisionId") REFERENCES "QuoteRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerActivity" ADD CONSTRAINT "CustomerActivity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerActivity" ADD CONSTRAINT "CustomerActivity_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "QuoteRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerActivity" ADD CONSTRAINT "CustomerActivity_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerActivity" ADD CONSTRAINT "CustomerActivity_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "QuoteRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "QuoteRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAttachment" ADD CONSTRAINT "SalesAttachment_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAttachment" ADD CONSTRAINT "SalesAttachment_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAttachment" ADD CONSTRAINT "SalesAttachment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfill existing data
-- ---------------------------------------------------------------------------

-- Quote numbers WMQ-1001… in request order.
UPDATE "QuoteRequest" q SET "number" = 'WMQ-' || (1000 + n.rn)::text
FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "QuoteRequest") n
WHERE q."id" = n."id";

-- Existing orders keep their numbers; new ones continue from WMO-1001 upward.
INSERT INTO "Counter" ("key", "value")
SELECT 'quote', 1000 + count(*)::int FROM "QuoteRequest";
INSERT INTO "Counter" ("key", "value") VALUES ('invoice', 1000);
INSERT INTO "Counter" ("key", "value")
SELECT 'order', 1000 + count(*)::int FROM "Order";

-- One customer per exact (case-insensitive) email, named from their most
-- recent quote. Nothing is merged beyond an exact email match.
INSERT INTO "Customer" ("id", "name", "email", "phone", "zipCode", "lastActivityAt", "createdAt", "updatedAt")
SELECT 'cus' || md5(random()::text || clock_timestamp()::text || latest.email_key),
       latest."name", latest."email", latest."phone", latest."zipCode", latest.last_at, latest.first_at, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (lower(trim("email")))
         lower(trim("email")) AS email_key, "name", lower(trim("email")) AS "email", "phone", "zipCode",
         max("createdAt") OVER (PARTITION BY lower(trim("email"))) AS last_at,
         min("createdAt") OVER (PARTITION BY lower(trim("email"))) AS first_at
  FROM "QuoteRequest"
  ORDER BY lower(trim("email")), "createdAt" DESC
) latest;

UPDATE "QuoteRequest" q SET "customerId" = c."id"
FROM "Customer" c WHERE c."email" = lower(trim(q."email"));

UPDATE "Order" o SET "customerId" = c."id"
FROM "Customer" c WHERE c."email" = lower(trim(o."customerEmail"));
