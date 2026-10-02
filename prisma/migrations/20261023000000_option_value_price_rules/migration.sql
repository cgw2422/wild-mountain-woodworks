-- Conditional option pricing: a value's price can depend on another selected value.
CREATE TABLE "OptionValuePriceRule" (
    "id" TEXT NOT NULL,
    "optionValueId" TEXT NOT NULL,
    "dependsOnValueId" TEXT NOT NULL,
    "priceModifierCents" INTEGER NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OptionValuePriceRule_pkey" PRIMARY KEY ("id"),
    -- A value can't depend on itself (same-group dependencies are refused by the admin action).
    CONSTRAINT "OptionValuePriceRule_not_self" CHECK ("optionValueId" <> "dependsOnValueId")
);

CREATE UNIQUE INDEX "OptionValuePriceRule_optionValueId_dependsOnValueId_key" ON "OptionValuePriceRule"("optionValueId", "dependsOnValueId");
CREATE INDEX "OptionValuePriceRule_optionValueId_displayOrder_idx" ON "OptionValuePriceRule"("optionValueId", "displayOrder");
CREATE INDEX "OptionValuePriceRule_dependsOnValueId_idx" ON "OptionValuePriceRule"("dependsOnValueId");

ALTER TABLE "OptionValuePriceRule" ADD CONSTRAINT "OptionValuePriceRule_optionValueId_fkey" FOREIGN KEY ("optionValueId") REFERENCES "OptionValue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OptionValuePriceRule" ADD CONSTRAINT "OptionValuePriceRule_dependsOnValueId_fkey" FOREIGN KEY ("dependsOnValueId") REFERENCES "OptionValue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
