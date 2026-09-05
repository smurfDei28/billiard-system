const { BRACKET_STAGES, resolveDoubleEliminationByes, routingSlot } = require('./doubleEliminationBracket.service');
const { releaseTournamentMatchTable } = require('./tournamentMatchOperations.service');
const { updatePlayerRank } = require('../utils/gamification');

const TOURNAMENT_WIN_XP = 75;
const TOURNAMENT_LOSS_XP = 25;
const TOURNAMENT_CHAMPION_XP = 150;
const TOURNAMENT_CHAMPION_CREDITS = 120;

const failure = (message, status) => Object.assign(new Error(message), { status });

const routeToMatch = async ({ db, sourceMatch, participantId, destinationId, route, playerCount, isDoubleElimination, usesExplicitDoubleEliminationRoutes }) => {
  if (!destinationId) return null;
  const destination = await db.tournamentMatch.findUnique({ where: { id: destinationId } });
  if (!destination) throw failure('Bracket destination match was not found', 409);
  if (destination.status === 'COMPLETED') throw failure('Bracket destination match is already completed', 409);

  let slot;
  if (usesExplicitDoubleEliminationRoutes && (sourceMatch.bracketStage === BRACKET_STAGES.WINNERS || sourceMatch.bracketStage === BRACKET_STAGES.LOSERS)) {
    const configured = routingSlot({ playerCount, sourceMatch, route });
    if (!configured) throw failure('Bracket route slot is not configured', 409);
    slot = configured.slot;
  }

  // Single Elimination feeder matches, and legacy Double Elimination records
  // generated before explicit winner/loser route fields existed, are created in
  // pairs. Their globally increasing match numbers begin at an odd number in
  // every round, so the first feeder owns player1 and the second owns player2.
  // This must not depend on which feeder reports first.
  if (!slot && Number.isInteger(sourceMatch.matchNumber)) {
    slot = sourceMatch.matchNumber % 2 === 1 ? 1 : 2;
  }
  // Legacy records without a match number predate deterministic feeder data;
  // preserve their historical first-open-slot behavior rather than rewriting
  // an in-progress bracket during result submission.
  const field = slot === 1 ? 'player1Id' : slot === 2 ? 'player2Id' : (!destination.player1Id ? 'player1Id' : 'player2Id');
  if (destination[field] && destination[field] !== participantId) {
    throw Object.assign(failure('Bracket destination slot is occupied by a different participant', 409), {
      code: 'BRACKET_DESTINATION_CONFLICT',
      routing: {
        tournamentId: sourceMatch.tournamentId,
        sourceMatchId: sourceMatch.id,
        sourceStage: sourceMatch.bracketStage || 'SINGLE_ELIMINATION',
        route,
        participantId,
        destinationMatchId: destination.id,
        destinationSlot: field,
        existingParticipantId: destination[field],
      },
    });
  }
  if (destination[field] === participantId) return destination;
  return db.tournamentMatch.update({ where: { id: destination.id }, data: { [field]: participantId } });
};

const completeTournamentMatchWithDb = async ({ db, matchId, player1Score, player2Score, suppliedWinnerId }) => {
  const existingMatch = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    include: { tournament: { select: { id: true, name: true, raceTo: true, format: true } } },
  });
  if (!existingMatch) throw failure('Match not found', 404);
  if (existingMatch.status === 'COMPLETED') return { match: existingMatch, alreadyCompleted: true, bracketResolved: false };
  if (existingMatch.status === 'BYE') throw failure('A BYE match is already resolved and cannot receive a result', 409);
  if (!existingMatch.scheduledAt || !existingMatch.tableId) throw failure('Please assign a schedule and table before submitting a result', 409);
  if (!existingMatch.startedAt || existingMatch.status !== 'IN_PROGRESS') throw failure('Start this match before submitting a result', 409);
  if (!existingMatch.player1Id || !existingMatch.player2Id) throw failure('Both match participants are required', 409);

  const score1 = Number(player1Score);
  const score2 = Number(player2Score);
  const raceTo = existingMatch.tournament.raceTo || 5;
  if (!Number.isInteger(score1) || !Number.isInteger(score2) || score1 < 0 || score2 < 0 || score1 === score2 || Math.max(score1, score2) !== raceTo || Math.min(score1, score2) >= raceTo) {
    throw failure(`Final score must have exactly one player reach Race To ${raceTo}.`, 400);
  }
  const winnerId = score1 === raceTo ? existingMatch.player1Id : existingMatch.player2Id;
  if (suppliedWinnerId && suppliedWinnerId !== winnerId) throw failure('Winner does not match the submitted score.', 400);
  const loserId = winnerId === existingMatch.player1Id ? existingMatch.player2Id : existingMatch.player1Id;

  const match = await db.tournamentMatch.update({
    where: { id: matchId },
    data: { player1Score: score1, player2Score: score2, winnerId, status: 'COMPLETED', completedAt: new Date() },
  });

  await db.gamifiedProfile.update({
    where: { userId: winnerId },
    data: { totalWins: { increment: 1 }, totalGames: { increment: 1 }, xp: { increment: TOURNAMENT_WIN_XP }, winStreak: { increment: 1 } },
  });
  await db.gamifiedProfile.update({
    where: { userId: loserId },
    data: { totalLosses: { increment: 1 }, totalGames: { increment: 1 }, xp: { increment: TOURNAMENT_LOSS_XP }, winStreak: 0 },
  });
  await updatePlayerRank(db, winnerId);

  let pendingFeeNotification = null;
  let lossFeeStatus = null;
  const loserMembership = await db.membership.findUnique({ where: { userId: loserId } });
  if (loserMembership && Number(loserMembership.creditBalance) >= 200) {
    const charged = await db.membership.update({ where: { userId: loserId }, data: { creditBalance: { decrement: 200 } } });
    await db.creditTransaction.create({
      data: { userId: loserId, type: 'DEDUCTION', amount: 200, balanceBefore: loserMembership.creditBalance, balanceAfter: charged.creditBalance, description: `Tournament match loss fee: ${match.tournamentId}` },
    });
    lossFeeStatus = 'DEDUCTED';
  } else {
    await db.tournamentFeeLiability.create({
      data: {
        userId: loserId,
        tournamentId: match.tournamentId,
        tournamentMatchId: match.id,
        feeType: 'TOURNAMENT_MATCH_LOSS',
        amount: 200,
        status: 'PENDING',
      },
    });
    pendingFeeNotification = { userId: loserId, matchId: match.id };
    lossFeeStatus = 'PENDING';
  }

  let playerCount = null;
  if (existingMatch.tournament.format === 'DOUBLE_ELIMINATION') {
    const matchCount = await db.tournamentMatch.count({ where: { tournamentId: match.tournamentId } });
    playerCount = matchCount === 7 ? 4 : matchCount === 15 ? 8 : null;
    if (!playerCount) throw failure('Double Elimination bracket structure is invalid', 409);
  }

  let bracketResolved = false;
  let resetRequired = false;
  if (match.isResetFinal || match.bracketStage === BRACKET_STAGES.RESET_FINAL) {
    bracketResolved = true;
  } else if (match.isGrandFinal || match.bracketStage === BRACKET_STAGES.GRAND_FINAL) {
    if (winnerId === match.player1Id) {
      bracketResolved = true;
    } else {
      const reset = await db.tournamentMatch.findFirst({ where: { tournamentId: match.tournamentId, isResetFinal: true } });
      if (!reset) throw failure('Reset Final structure was not found', 409);
      if ((reset.player1Id && reset.player1Id !== match.player1Id) || (reset.player2Id && reset.player2Id !== match.player2Id)) {
        throw failure('Reset Final slots are occupied by different participants', 409);
      }
      if (!reset.player1Id || !reset.player2Id) {
        await db.tournamentMatch.update({ where: { id: reset.id }, data: { player1Id: match.player1Id, player2Id: match.player2Id } });
      }
      resetRequired = true;
    }
  } else {
    const winnerDestination = match.nextWinnerMatchId || match.nextMatchId;
    const usesExplicitDoubleEliminationRoutes = existingMatch.tournament.format === 'DOUBLE_ELIMINATION'
      && !!(match.nextWinnerMatchId || match.nextLoserMatchId);
    await routeToMatch({ db, sourceMatch: match, participantId: winnerId, destinationId: winnerDestination, route: 'winner', playerCount, isDoubleElimination: existingMatch.tournament.format === 'DOUBLE_ELIMINATION', usesExplicitDoubleEliminationRoutes });
    if (match.bracketStage === BRACKET_STAGES.WINNERS && match.nextLoserMatchId) {
      await routeToMatch({ db, sourceMatch: match, participantId: loserId, destinationId: match.nextLoserMatchId, route: 'loser', playerCount, isDoubleElimination: true, usesExplicitDoubleEliminationRoutes });
    }
    if (existingMatch.tournament.format === 'DOUBLE_ELIMINATION') {
      await resolveDoubleEliminationByes({ db, tournamentId: match.tournamentId, playerCount });
    }
  }

  // A Single Elimination final is the sole match in the highest persisted round;
  // do not infer a final merely from a missing next-route on historical records.
  if (existingMatch.tournament.format === 'SINGLE_ELIMINATION' && !match.nextWinnerMatchId && !match.nextMatchId) {
    const tournamentMatches = await db.tournamentMatch.findMany({ where: { tournamentId: match.tournamentId } });
    const highestRound = Math.max(...tournamentMatches.map((item) => item.round || 0));
    bracketResolved = match.round === highestRound && tournamentMatches.filter((item) => item.round === highestRound).length === 1;
  }

  let tournamentCompleted = false;
  let championRewarded = false;
  if (bracketResolved) {
    const completedAt = new Date();
    await db.tournament.update({ where: { id: match.tournamentId }, data: { status: 'COMPLETED', endDate: completedAt } });
    const championWhere = { userId_tournamentId: { userId: winnerId, tournamentId: match.tournamentId } };
    const existingChampion = await db.championTitle.findUnique({ where: championWhere });
    if (!existingChampion) {
      await db.championTitle.create({
        data: { userId: winnerId, tournamentId: match.tournamentId, tournamentName: existingMatch.tournament.name, format: existingMatch.tournament.format, earnedAt: completedAt },
      });
      await db.gamifiedProfile.update({ where: { userId: winnerId }, data: { xp: { increment: TOURNAMENT_CHAMPION_XP } } });
      const championMembership = await db.membership.findUnique({ where: { userId: winnerId } });
      if (championMembership) {
        const updatedMembership = await db.membership.update({ where: { userId: winnerId }, data: { creditBalance: { increment: TOURNAMENT_CHAMPION_CREDITS } } });
        await db.creditTransaction.create({
          data: {
            userId: winnerId,
            type: 'LOYALTY_REWARD',
            amount: TOURNAMENT_CHAMPION_CREDITS,
            balanceBefore: championMembership.creditBalance,
            balanceAfter: updatedMembership.creditBalance,
            description: `Tournament champion reward: ${existingMatch.tournament.name}`,
          },
        });
        await db.loyaltyHistory.create({
          data: {
            userId: winnerId,
            trigger: 'TOURNAMENT_WIN',
            creditsAwarded: TOURNAMENT_CHAMPION_CREDITS,
            description: 'Tournament champion reward — 120 credits',
          },
        });
      }
      await updatePlayerRank(db, winnerId, { hasTournamentWin: true });
      championRewarded = true;
    }
    tournamentCompleted = true;
  }

  const releasedTableId = await releaseTournamentMatchTable({ db, match });

  return { match, winnerId, loserId, alreadyCompleted: false, bracketResolved, resetRequired, tournamentCompleted, championRewarded, pendingFeeNotification, lossFeeStatus, releasedTableId };
};

const completeTournamentMatch = ({ prisma, matchId, player1Score, player2Score, suppliedWinnerId }) =>
  prisma.$transaction(
    (db) => completeTournamentMatchWithDb({ db, matchId, player1Score, player2Score, suppliedWinnerId }),
    {
      isolationLevel: 'Serializable',
      maxWait: 10000,
      timeout: 20000,
    }
  );

module.exports = { completeTournamentMatch, completeTournamentMatchWithDb, TOURNAMENT_WIN_XP, TOURNAMENT_LOSS_XP, TOURNAMENT_CHAMPION_XP, TOURNAMENT_CHAMPION_CREDITS };
