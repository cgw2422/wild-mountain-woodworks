-- Quantity-based option values (e.g. dining chairs: style + how many, priced
-- per unit). Purely additive: every existing value gets quantityEnabled =
-- false, so existing products, prices, quotes, orders and invoices are
-- unchanged (snapshots already store their own copies of everything).
ALTER TABLE "OptionValue"
  ADD COLUMN "quantityEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "quantityMin" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "quantityMax" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "quantityStep" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "quantityDefault" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OptionValue"
  ADD CONSTRAINT "OptionValue_quantity_range_check" CHECK (
    "quantityMin" >= 0 AND "quantityMax" >= "quantityMin" AND "quantityMax" <= 999 AND "quantityStep" >= 1
    AND "quantityDefault" >= "quantityMin" AND "quantityDefault" <= "quantityMax"
  );
