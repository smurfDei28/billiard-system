-- Preserve all existing phone values and the existing unique index while
-- allowing new accounts to omit a phone number. PostgreSQL unique indexes
-- continue to reject duplicate non-NULL values and permit multiple NULLs.
ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL;
