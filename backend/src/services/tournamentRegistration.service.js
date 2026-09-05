const prisma = require('../config/prisma');
const { generateSingleEliminationBracket } = require('./singleEliminationBracket.service');
const { generateDoubleEliminationBracket } = require('./doubleEliminationBracket.service');
const { formatLabel, notifyTournamentUsers, participantName } = require('./tournamentNotification.service');

const closeTournamentRegistrationWithDb = async ({
  db,
  tournamentId,
  generateBracket = generateSingleEliminationBracket,
  generateDoubleBracket = generateDoubleEliminationBracket,
}) => {
  const tournament = await db.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) throw Object.assign(new Error('Tournament not found'), { status: 404 });
  if (['REGISTRATION_CLOSED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(tournament.status)) {
    return { tournament, alreadyClosed: true, eligibleCount: 0, bracketPending: tournament.format === 'DOUBLE_ELIMINATION' };
  }
  // Paid registrations determine the prize pool independently from the active
  // entries allowed into a bracket. Paid, later-cancelled entries remain counted.
  const eligible = await db.tournamentEntry.findMany({ where: { tournamentId, status: { in: ['APPROVED', 'CHECKED_IN'] }, paidAt: { not: null } } });
  const paidCount = await db.tournamentEntry.count({ where: { tournamentId, paidAt: { not: null } } });
  const existingMatchCount = await db.tournamentMatch.count({ where: { tournamentId } });
  let bracketGenerated = false;
  let bracketReason = null;

  if (tournament.format === 'SINGLE_ELIMINATION') {
    if (existingMatchCount > 0) {
      bracketGenerated = true;
    } else if (eligible.length < 2) {
      bracketReason = 'INSUFFICIENT_ELIGIBLE_PARTICIPANTS';
    } else {
      const players = [...eligible].sort(() => Math.random() - 0.5);
      await generateBracket({ db, tournamentId, players });
      bracketGenerated = true;
    }
  } else if (tournament.format === 'DOUBLE_ELIMINATION') {
    if (existingMatchCount > 0) {
      bracketGenerated = true;
    } else {
      const players = [...eligible].sort(() => Math.random() - 0.5);
      const result = await generateDoubleBracket({ db, tournamentId, players });
      bracketGenerated = result.generated;
      bracketReason = result.reason || null;
    }
  }

  const finalized = await db.tournament.update({
    where: { id: tournamentId },
    data: { status: 'REGISTRATION_CLOSED', finalPrizePool: paidCount * Number(tournament.entryFee || 0) },
  });
  return {
    tournament: finalized,
    alreadyClosed: false,
    eligibleCount: eligible.length,
    bracketPending: tournament.format === 'DOUBLE_ELIMINATION' && !bracketGenerated,
    bracketGenerated,
    ...(bracketReason && { bracketReason }),
  };
};

const closeTournamentRegistration = async (tournamentId) => {
  const result = await prisma.$transaction((tx) => closeTournamentRegistrationWithDb({ db: tx, tournamentId }));
  // Scheduler/manual retries return alreadyClosed, so only the one successful
  // bracket generation creates a member-facing notification.
  if (!result.alreadyClosed && result.bracketGenerated) {
    const detail = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { matches: true, entries: { include: { user: { include: { gamifiedProfile: true } } } } },
    });
    const activeEntries = detail?.entries?.filter((entry) => ['APPROVED', 'CHECKED_IN'].includes(entry.status)) || [];
    await Promise.all(activeEntries.map(async (entry) => {
      const firstMatch = detail.matches.find((match) => (match.player1Id === entry.userId || match.player2Id === entry.userId) && match.player1Id && match.player2Id);
      const opponentId = firstMatch?.player1Id === entry.userId ? firstMatch.player2Id : firstMatch?.player1Id;
      await notifyTournamentUsers({
        db: prisma,
        userIds: [entry.userId],
        title: 'Tournament Bracket Ready',
        message: `${detail.name} (${formatLabel(detail.format)}) bracket is ready. ${opponentId ? `Your first opponent is ${participantName(detail.entries, opponentId)}. ` : ''}Race To ${detail.raceTo || 5}.`,
        data: { tournamentId, matchId: firstMatch?.id },
      });
    }));
  }
  return result;
};

module.exports = { closeTournamentRegistration, closeTournamentRegistrationWithDb };
