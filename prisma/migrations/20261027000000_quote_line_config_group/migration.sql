-- Quote lines generated from one configured catalog product share a group id.
ALTER TABLE "QuoteLineItem" ADD COLUMN "configGroup" TEXT;
