CREATE UNIQUE INDEX IF NOT EXISTS "tournament_matches_tableId_scheduledAt_key"
ON "tournament_matches"("tableId", "scheduledAt");
