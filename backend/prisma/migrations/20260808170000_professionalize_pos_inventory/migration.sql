ALTER TABLE "products" ADD COLUMN "costPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "stock_history"
  ADD COLUMN "stockBefore" INTEGER,
  ADD COLUMN "stockAfter" INTEGER;

ALTER TABLE "orders"
  ADD COLUMN "receiptNumber" TEXT,
  ADD COLUMN "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "amountTendered" DOUBLE PRECISION,
  ADD COLUMN "changeDue" DOUBLE PRECISION,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN "voidReason" TEXT,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedBy" TEXT;

CREATE UNIQUE INDEX "orders_receiptNumber_key" ON "orders"("receiptNumber");
