ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "registrationDeadline" TIMESTAMP(3);
ALTER TABLE "tournament_matches" ADD COLUMN IF NOT EXISTS "nextWinnerMatchId" TEXT;
ALTER TABLE "tournament_matches" ADD COLUMN IF NOT EXISTS "nextLoserMatchId" TEXT;
ALTER TABLE "tournament_matches" ADD COLUMN IF NOT EXISTS "bracketStage" TEXT NOT NULL DEFAULT 'WINNERS';
ALTER TABLE "tournament_matches" ADD COLUMN IF NOT EXISTS "isGrandFinal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tournament_matches" ADD COLUMN IF NOT EXISTS "isResetFinal" BOOLEAN NOT NULL DEFAULT false;
UPDATE "tournament_matches" SET "nextWinnerMatchId" = "nextMatchId" WHERE "nextWinnerMatchId" IS NULL AND "nextMatchId" IS NOT NULL;
