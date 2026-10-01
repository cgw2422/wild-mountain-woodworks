-- AlterEnum
ALTER TYPE "QuoteStatus" ADD VALUE 'VOIDED';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "voidedById" TEXT;

-- AlterTable
ALTER TABLE "QuoteRequest" ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT,
ADD COLUMN     "voidedFromStatus" "QuoteStatus";


-- Quotes, invoices, payments, orders and their audit trail are permanent
-- business history: void them, never delete them. These guards hold even
-- for code paths or SQL that bypass the app. (TRUNCATE by the database owner
-- — used only to reset local/test databases — is not a row delete.)
CREATE OR REPLACE FUNCTION wm_prevent_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rows in "%" are permanent business records and cannot be deleted. Void them instead.', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER wm_no_delete BEFORE DELETE ON "QuoteRequest" FOR EACH ROW EXECUTE FUNCTION wm_prevent_delete();
CREATE TRIGGER wm_no_delete BEFORE DELETE ON "QuoteRevision" FOR EACH ROW EXECUTE FUNCTION wm_prevent_delete();
CREATE TRIGGER wm_no_delete BEFORE DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION wm_prevent_delete();
CREATE TRIGGER wm_no_delete BEFORE DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION wm_prevent_delete();
CREATE TRIGGER wm_no_delete BEFORE DELETE ON "Order" FOR EACH ROW EXECUTE FUNCTION wm_prevent_delete();
CREATE TRIGGER wm_no_delete BEFORE DELETE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION wm_prevent_delete();
-- Status history of quotes, orders and invoices (inbox messages' history may still go with them).
CREATE TRIGGER wm_no_delete BEFORE DELETE ON "StatusEvent" FOR EACH ROW
  WHEN (OLD."quoteRequestId" IS NOT NULL OR OLD."orderId" IS NOT NULL OR OLD."invoiceId" IS NOT NULL)
  EXECUTE FUNCTION wm_prevent_delete();
CREATE TRIGGER wm_no_delete BEFORE DELETE ON "ActivityLog" FOR EACH ROW EXECUTE FUNCTION wm_prevent_delete();

-- Line items may only be replaced while their quote revision / invoice is a
-- draft; once sent they are part of what the customer saw.
CREATE OR REPLACE FUNCTION wm_prevent_sent_quote_line_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "QuoteRevision" WHERE id = OLD."revisionId" AND status <> 'DRAFT') THEN
    RAISE EXCEPTION 'Line items of a sent quote revision are permanent.';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION wm_prevent_issued_invoice_line_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Invoice" WHERE id = OLD."invoiceId" AND status <> 'DRAFT') THEN
    RAISE EXCEPTION 'Line items of an issued invoice are permanent.';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER wm_no_issued_line_delete BEFORE DELETE ON "QuoteLineItem" FOR EACH ROW EXECUTE FUNCTION wm_prevent_sent_quote_line_delete();
CREATE TRIGGER wm_no_issued_line_delete BEFORE DELETE ON "InvoiceLineItem" FOR EACH ROW EXECUTE FUNCTION wm_prevent_issued_invoice_line_delete();
