-- A configurable add-on's option group can set the price per unit (e.g. each
-- Chair Style carries its own per-chair price) instead of adjusting the
-- add-on's base price. Additive: existing rows default to false, so current
-- pricing is unchanged until an admin switches it on; saved quotes, orders
-- and invoices carry their own prices and are never recalculated.
ALTER TABLE "AddOnOptionGroup" ADD COLUMN "setsUnitPrice" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "AddOnOptionGroup_one_unit_price_group" ON "AddOnOptionGroup"("addOnId") WHERE "setsUnitPrice";
