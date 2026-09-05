-- Add an auditable, cash-only, winner-takes-all payout record for completed tournaments.
CREATE TABLE "tournament_payouts" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournament_payouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tournament_payouts_tournamentId_key" ON "tournament_payouts"("tournamentId");
CREATE INDEX "tournament_payouts_recipientId_idx" ON "tournament_payouts"("recipientId");

ALTER TABLE "tournament_payouts" ADD CONSTRAINT "tournament_payouts_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournament_payouts" ADD CONSTRAINT "tournament_payouts_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tournament_payouts" ADD CONSTRAINT "tournament_payouts_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
