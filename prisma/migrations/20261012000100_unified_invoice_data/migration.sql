-- Unified invoice model (data part). Existing invoices and payments are kept
-- exactly as they are — no merging, no amounts changed. Older orders keep
-- their separate deposit / balance invoices; new orders get one invoice.

-- An older deposit invoice is entirely the deposit.
UPDATE "Invoice" SET "depositCents" = "totalCents" WHERE "kind" = 'DEPOSIT' AND "depositCents" = 0;

-- Payment purpose from the invoice it was recorded against.
UPDATE "Payment" p SET "type" = (CASE i."kind" WHEN 'DEPOSIT' THEN 'DEPOSIT' WHEN 'BALANCE' THEN 'FINAL_BALANCE' ELSE 'OTHER' END)::"PaymentType"
FROM "Invoice" i WHERE i."id" = p."invoiceId";

-- Unsettled payments (none settled yet are double counted).
UPDATE "Invoice" i SET "pendingCents" = COALESCE((SELECT SUM(p."amountCents") FROM "Payment" p WHERE p."invoiceId" = i."id" AND p."status" = 'PENDING'), 0);

-- Issued balance / full / custom invoices were sent to be paid: their balance is due.
UPDATE "Invoice" SET "balanceDueAt" = COALESCE("sentAt", "createdAt")
WHERE "kind" <> 'DEPOSIT' AND "status" IN ('SENT', 'OPEN', 'PAST_DUE', 'PARTIALLY_PAID') AND "balanceDueAt" IS NULL;

-- Balance-based status (drafts, voided and canceled invoices are left alone).
UPDATE "Invoice" SET "status" = (CASE
  WHEN "totalCents" > 0 AND "amountPaidCents" >= "totalCents" THEN 'PAID'
  WHEN "balanceDueAt" IS NOT NULL THEN 'BALANCE_DUE'
  WHEN "depositCents" > 0 AND "amountPaidCents" < "depositCents" THEN 'DEPOSIT_DUE'
  WHEN "amountPaidCents" > 0 THEN 'PARTIALLY_PAID'
  ELSE 'OPEN'
END)::"InvoiceStatus"
WHERE "status" IN ('SENT', 'OPEN', 'PAST_DUE', 'PARTIALLY_PAID', 'PAID');

-- Orders whose balance has been requested.
UPDATE "Order" o SET "paymentStatus" = 'BALANCE_DUE'
WHERE o."paymentStatus" IN ('UNPAID', 'DEPOSIT_DUE', 'PARTIALLY_PAID')
  AND EXISTS (SELECT 1 FROM "Invoice" i WHERE i."orderId" = o."id" AND i."status" = 'BALANCE_DUE');
