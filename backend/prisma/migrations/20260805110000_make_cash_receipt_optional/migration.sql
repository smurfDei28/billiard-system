-- Cash top-up requests do not require an image receipt. Existing receipt URLs
-- and payment records are preserved unchanged.
ALTER TABLE "manual_payments" ALTER COLUMN "receiptUrl" DROP NOT NULL;
