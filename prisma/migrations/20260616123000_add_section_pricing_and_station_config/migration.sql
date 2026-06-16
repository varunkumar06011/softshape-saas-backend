-- AlterTable
ALTER TABLE "TenantMenuItem" ADD COLUMN "priceOverrides" TEXT DEFAULT '{}';

-- AlterTable
ALTER TABLE "CashierStation" ADD COLUMN "allowedSections" TEXT DEFAULT '[]';
ALTER TABLE "CashierStation" ADD COLUMN "handleOnlineOrders" BOOLEAN NOT NULL DEFAULT false;
