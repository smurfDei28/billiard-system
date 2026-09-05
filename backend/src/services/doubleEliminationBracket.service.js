const BRACKET_STAGES = Object.freeze({
  WINNERS: 'WINNERS',
  LOSERS: 'LOSERS',
  GRAND_FINAL: 'GRAND_FINAL',
  RESET_FINAL: 'RESET_FINAL',
});

const unsupportedPlayerCount = (count) => ![4, 8].includes(count);

const plans = {
  4: [
    { key: 'W1-1', stage: BRACKET_STAGES.WINNERS, round: 1, players: [0, 1], winner: ['W2-1', 1], loser: ['L1-1', 1] },
    { key: 'W1-2', stage: BRACKET_STAGES.WINNERS, round: 1, players: [2, 3], winner: ['W2-1', 2], loser: ['L1-1', 2] },
    { key: 'W2-1', stage: BRACKET_STAGES.WINNERS, round: 2, winner: ['GF-1', 1], loser: ['L2-1', 2] },
    { key: 'L1-1', stage: BRACKET_STAGES.LOSERS, round: 1, winner: ['L2-1', 1] },
    { key: 'L2-1', stage: BRACKET_STAGES.LOSERS, round: 2, winner: ['GF-1', 2] },
    { key: 'GF-1', stage: BRACKET_STAGES.GRAND_FINAL, round: 3, grandFinal: true },
    { key: 'RF-1', stage: BRACKET_STAGES.RESET_FINAL, round: 4, resetFinal: true },
  ],
  8: [
    { key: 'W1-1', stage: BRACKET_STAGES.WINNERS, round: 1, players: [0, 1], winner: ['W2-1', 1], loser: ['L1-1', 1] },
    { key: 'W1-2', stage: BRACKET_STAGES.WINNERS, round: 1, players: [2, 3], winner: ['W2-1', 2], loser: ['L1-1', 2] },
    { key: 'W1-3', stage: BRACKET_STAGES.WINNERS, round: 1, players: [4, 5], winner: ['W2-2', 1], loser: ['L1-2', 1] },
    { key: 'W1-4', stage: BRACKET_STAGES.WINNERS, round: 1, players: [6, 7], winner: ['W2-2', 2], loser: ['L1-2', 2] },
    { key: 'W2-1', stage: BRACKET_STAGES.WINNERS, round: 2, winner: ['W3-1', 1], loser: ['L2-1', 2] },
    { key: 'W2-2', stage: BRACKET_STAGES.WINNERS, round: 2, winner: ['W3-1', 2], loser: ['L2-2', 2] },
    { key: 'W3-1', stage: BRACKET_STAGES.WINNERS, round: 3, winner: ['GF-1', 1], loser: ['L3-2', 2] },
    { key: 'L1-1', stage: BRACKET_STAGES.LOSERS, round: 1, winner: ['L2-1', 1] },
    { key: 'L1-2', stage: BRACKET_STAGES.LOSERS, round: 1, winner: ['L2-2', 1] },
    { key: 'L2-1', stage: BRACKET_STAGES.LOSERS, round: 2, winner: ['L3-1', 1] },
    { key: 'L2-2', stage: BRACKET_STAGES.LOSERS, round: 2, winner: ['L3-1', 2] },
    { key: 'L3-1', stage: BRACKET_STAGES.LOSERS, round: 3, winner: ['L3-2', 1] },
    { key: 'L3-2', stage: BRACKET_STAGES.LOSERS, round: 4, winner: ['GF-1', 2] },
    { key: 'GF-1', stage: BRACKET_STAGES.GRAND_FINAL, round: 4, grandFinal: true },
    { key: 'RF-1', stage: BRACKET_STAGES.RESET_FINAL, round: 5, resetFinal: true },
  ],
};

const routingSlot = ({ playerCount, sourceKey, sourceMatch, route }) => {
  const source = sourceKey
    ? plans[playerCount]?.find((match) => match.key === sourceKey)
    : plans[playerCount]?.[Number(sourceMatch?.matchNumber) - 1];
  const destination = source?.[route];
  return destination ? { destinationKey: destination[0], slot: destination[1] } : null;
};

const generateDoubleEliminationBracket = async ({ db, tournamentId, players }) => {
  const existingMatchCount = await db.tournamentMatch.count({ where: { tournamentId } });
  if (existingMatchCount > 0) return { generated: false, alreadyGenerated: true, reason: 'EXISTING_BRACKET' };
  if (unsupportedPlayerCount(players.length)) {
    return { generated: false, alreadyGenerated: false, reason: 'DOUBLE_ELIMINATION_REQUIRES_4_OR_8_PLAYERS' };
  }

  const plan = plans[players.length];
  const matchesByKey = new Map();
  let matchNumber = 1;
  for (const match of plan) {
    const player1Id = match.players ? players[match.players[0]]?.userId || null : null;
    const player2Id = match.players ? players[match.players[1]]?.userId || null : null;
    const created = await db.tournamentMatch.create({
      data: {
        tournamentId,
        round: match.round,
        matchNumber: matchNumber++,
        player1Id,
        player2Id,
        status: 'PENDING',
        nextMatchId: null,
        nextWinnerMatchId: null,
        nextLoserMatchId: null,
        bracketStage: match.stage,
        isLosers: match.stage === BRACKET_STAGES.LOSERS,
        isGrandFinal: !!match.grandFinal,
        isResetFinal: !!match.resetFinal,
      },
    });
    matchesByKey.set(match.key, created);
  }

  for (const match of plan) {
    const current = matchesByKey.get(match.key);
    const winnerDestination = match.winner && matchesByKey.get(match.winner[0]);
    const loserDestination = match.loser && matchesByKey.get(match.loser[0]);
    if (winnerDestination || loserDestination) {
      await db.tournamentMatch.update({
        where: { id: current.id },
        data: {
          // Keep legacy nextMatchId aligned with the winner route. Result
          // processing will be upgraded separately to use both route fields.
          nextMatchId: winnerDestination?.id || null,
          nextWinnerMatchId: winnerDestination?.id || null,
          nextLoserMatchId: loserDestination?.id || null,
        },
      });
    }
  }

  return {
    generated: true,
    alreadyGenerated: false,
    playerCount: players.length,
    matches: plan.map((match) => ({ ...matchesByKey.get(match.key), key: match.key })),
  };
};

module.exports = { BRACKET_STAGES, generateDoubleEliminationBracket, routingSlot };
