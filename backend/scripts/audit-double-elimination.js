const prisma = require('../src/config/prisma');

const auditDoubleEliminationTournament = async (db, tournamentId) => {
  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      name: true,
      format: true,
      status: true,
      entries: { select: { userId: true, status: true } },
      matches: {
        orderBy: { matchNumber: 'asc' },
        select: {
          id: true, round: true, matchNumber: true, player1Id: true, player2Id: true,
          player1Score: true, player2Score: true, winnerId: true, status: true,
          nextMatchId: true, nextWinnerMatchId: true, nextLoserMatchId: true,
          bracketStage: true, isLosers: true, isGrandFinal: true, isResetFinal: true,
        },
      },
    },
  });
  if (!tournament) throw new Error('Tournament not found.');
  if (tournament.format !== 'DOUBLE_ELIMINATION') throw new Error('The selected tournament is not Double Elimination.');

  const stages = new Set(tournament.matches.map((match) => match.bracketStage || 'WINNERS'));
  const hasLosersBracket = stages.has('LOSERS') || tournament.matches.some((match) => match.isLosers);
  const hasGrandFinal = stages.has('GRAND_FINAL') || tournament.matches.some((match) => match.isGrandFinal);
  const hasResetFinal = stages.has('RESET_FINAL') || tournament.matches.some((match) => match.isResetFinal);
  const hasExplicitRoutes = tournament.matches.some((match) => match.nextWinnerMatchId || match.nextLoserMatchId);
  const legacyWinnersOnly = [3, 7].includes(tournament.matches.length) && !hasLosersBracket && !hasGrandFinal && !hasResetFinal && !hasExplicitRoutes;

  return {
    tournamentId: tournament.id,
    name: tournament.name,
    status: tournament.status,
    entryCount: tournament.entries.length,
    matchCount: tournament.matches.length,
    completedMatchCount: tournament.matches.filter((match) => match.status === 'COMPLETED').length,
    unresolvedEmptyMatches: tournament.matches.filter((match) => match.status === 'PENDING' && !match.player1Id && !match.player2Id).map((match) => match.id),
    hasLosersBracket,
    hasGrandFinal,
    hasResetFinal,
    hasExplicitRoutes,
    legacyWinnersOnly,
    requiresTournamentSpecificRepair: legacyWinnersOnly,
    matches: tournament.matches,
  };
};

const run = async () => {
  const tournamentId = String(process.argv[2] || '').trim();
  if (!tournamentId) throw new Error('Usage: node scripts/audit-double-elimination.js <tournament-id>');
  const report = await auditDoubleEliminationTournament(prisma, tournamentId);
  console.log(JSON.stringify(report, null, 2));
};

if (require.main === module) {
  run()
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}

module.exports = { auditDoubleEliminationTournament };
