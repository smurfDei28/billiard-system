ALTER TYPE "ManualPaymentPurpose" ADD VALUE IF NOT EXISTS 'ORDER';

CREATE TYPE "OrderSource" AS ENUM ('STAFF_POS', 'MEMBER_SHOP');
CREATE TYPE "OrderPaymentStatus" AS ENUM ('PENDING', 'PAID', 'REJECTED', 'REFUNDED');
CREATE TYPE "OrderFulfillmentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED');

ALTER TABLE "orders"
  ALTER COLUMN "staffId" DROP NOT NULL,
  ADD COLUMN "source" "OrderSource" NOT NULL DEFAULT 'STAFF_POS',
  ADD COLUMN "paymentStatus" "OrderPaymentStatus" NOT NULL DEFAULT 'PAID',
  ADD COLUMN "fulfillmentStatus" "OrderFulfillmentStatus" NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN "note" TEXT;

ALTER TABLE "manual_payments" ADD COLUMN "orderId" TEXT;
ALTER TABLE "manual_payments" ADD CONSTRAINT "manual_payments_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "manual_payments_orderId_status_idx" ON "manual_payments"("orderId", "status");
