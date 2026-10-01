-- AlterTable
ALTER TABLE "SiteSetting" ADD COLUMN     "paymentAffirmMessaging" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "paymentFinancingMessaging" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "paymentKlarnaMessaging" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "paymentMessagingHeading" TEXT NOT NULL DEFAULT 'Flexible payment options available',
ADD COLUMN     "paymentMessagingText" TEXT,
ADD COLUMN     "paymentMethodsMessaging" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "paymentMethodsText" TEXT NOT NULL DEFAULT 'Card · Bank · Apple Pay · Link · Cash App Pay · Amazon Pay · Affirm · Klarna';

