-- Configurable product add-ons (e.g. Dining Chairs with their own style,
-- quantity, wood, chair finish and seat finish). Purely additive: existing
-- add-ons keep their behavior (quantityEnabled defaults to true, as before;
-- no option groups attached), and existing quote, order and invoice lines get
-- a NULL add-on detail column, so they read and render exactly as before.
ALTER TABLE "AddOn"
  ADD COLUMN "displayName" TEXT,
  ADD COLUMN "quantityEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "quantityStep" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "defaultQuantity" INTEGER;
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_quantity_step_check" CHECK ("quantityStep" >= 1);

CREATE TABLE "AddOnOptionGroup" (
  "id" TEXT NOT NULL,
  "addOnId" TEXT NOT NULL,
  "optionGroupId" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "requiredOverride" BOOLEAN,
  "displayNameOverride" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AddOnOptionGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AddOnOptionGroup_addOnId_optionGroupId_key" ON "AddOnOptionGroup"("addOnId", "optionGroupId");
CREATE INDEX "AddOnOptionGroup_addOnId_displayOrder_idx" ON "AddOnOptionGroup"("addOnId", "displayOrder");
ALTER TABLE "AddOnOptionGroup" ADD CONSTRAINT "AddOnOptionGroup_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "AddOn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AddOnOptionGroup" ADD CONSTRAINT "AddOnOptionGroup_optionGroupId_fkey" FOREIGN KEY ("optionGroupId") REFERENCES "OptionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuoteLineItem" ADD COLUMN "addOn" JSONB;
ALTER TABLE "OrderItem" ADD COLUMN "addOn" JSONB;
ALTER TABLE "InvoiceLineItem" ADD COLUMN "addOn" JSONB;
