CREATE TABLE "tournament_fee_liabilities" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "tournamentEntryId" TEXT,
  "tournamentMatchId" TEXT,
  "feeType" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" TIMESTAMP(3),
  "creditTransactionId" TEXT,
  CONSTRAINT "tournament_fee_liabilities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tournament_fee_liabilities_tournamentMatchId_feeType_key" ON "tournament_fee_liabilities"("tournamentMatchId", "feeType");
CREATE INDEX "tournament_fee_liabilities_userId_status_createdAt_idx" ON "tournament_fee_liabilities"("userId", "status", "createdAt");
CREATE INDEX "tournament_fee_liabilities_tournamentId_idx" ON "tournament_fee_liabilities"("tournamentId");
