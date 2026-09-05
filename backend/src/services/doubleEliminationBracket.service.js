const BRACKET_STAGES = Object.freeze({
  WINNERS: 'WINNERS',
  LOSERS: 'LOSERS',
  GRAND_FINAL: 'GRAND_FINAL',
  RESET_FINAL: 'RESET_FINAL',
});

const bracketSizeForPlayerCount = (count) => {
  if (count >= 3 && count <= 4) return 4;
  if (count >= 5 && count <= 8) return 8;
  return null;
};

const unsupportedPlayerCount = (count) => !bracketSizeForPlayerCount(count);

const seedPlayersWithByes = (players, bracketSize) => {
  const slots = Array(bracketSize).fill(null);
  const byeCount = bracketSize - players.length;
  let playerIndex = 0;
  for (let matchIndex = 0; matchIndex < byeCount; matchIndex += 1) {
    slots[matchIndex * 2] = players[playerIndex++];
  }
  for (let slot = byeCount * 2; slot < slots.length; slot += 1) {
    slots[slot] = players[playerIndex++] || null;
  }
  return slots;
};

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

const doubleEliminationPlan = (bracketSize) => plans[bracketSize]?.map((match) => ({
  ...match,
  ...(match.players && { players: [...match.players] }),
  ...(match.winner && { winner: [...match.winner] }),
  ...(match.loser && { loser: [...match.loser] }),
}));

const routingSlot = ({ playerCount, sourceKey, sourceMatch, route }) => {
  const bracketSize = bracketSizeForPlayerCount(playerCount) || playerCount;
  const source = sourceKey
    ? plans[bracketSize]?.find((match) => match.key === sourceKey)
    : plans[bracketSize]?.[Number(sourceMatch?.matchNumber) - 1];
  const destination = source?.[route];
  return destination ? { destinationKey: destination[0], slot: destination[1] } : null;
};

const resolveDoubleEliminationByes = async ({ db, tournamentId, playerCount }) => {
  const bracketSize = bracketSizeForPlayerCount(playerCount) || playerCount;
  const plan = plans[bracketSize];
  if (!plan) throw Object.assign(new Error('Double Elimination bracket structure is invalid'), { status: 409 });

  const persisted = await db.tournamentMatch.findMany({
    where: { tournamentId },
    orderBy: { matchNumber: 'asc' },
  });
  if (persisted.length !== plan.length) throw Object.assign(new Error('Double Elimination bracket structure is invalid'), { status: 409 });

  const matchesByKey = new Map(plan.map((definition, index) => [definition.key, { ...persisted[index] }]));
  const incoming = new Map(plan.map((definition) => [definition.key, []]));
  for (const source of plan) {
    for (const route of ['winner', 'loser']) {
      const destination = source[route];
      if (destination) incoming.get(destination[0]).push({ sourceKey: source.key, route, slot: destination[1] });
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of plan) {
      if (definition.resetFinal) continue;
      const match = matchesByKey.get(definition.key);
      if (match.status !== 'PENDING' || (match.player1Id && match.player2Id)) continue;

      const feeders = incoming.get(definition.key);
      const inputsResolved = definition.players
        ? true
        : feeders.length > 0 && feeders.every(({ sourceKey }) => ['COMPLETED', 'BYE'].includes(matchesByKey.get(sourceKey).status));
      if (!inputsResolved) continue;

      const winnerId = match.player1Id || match.player2Id || null;
      const resolved = await db.tournamentMatch.update({
        where: { id: match.id },
        data: { status: 'BYE', winnerId, completedAt: new Date() },
      });
      matchesByKey.set(definition.key, { ...match, ...resolved });
      changed = true;

      if (!winnerId || !definition.winner) continue;
      const [destinationKey, slot] = definition.winner;
      const destination = matchesByKey.get(destinationKey);
      const field = slot === 1 ? 'player1Id' : 'player2Id';
      if (destination[field] && destination[field] !== winnerId) {
        throw Object.assign(new Error('Double Elimination BYE destination slot is occupied by a different participant'), { status: 409 });
      }
      if (!destination[field]) {
        const routed = await db.tournamentMatch.update({ where: { id: destination.id }, data: { [field]: winnerId } });
        matchesByKey.set(destinationKey, { ...destination, ...routed });
      }
    }
  }

  return [...matchesByKey.values()];
};

const generateDoubleEliminationBracket = async ({ db, tournamentId, players }) => {
  const existingMatchCount = await db.tournamentMatch.count({ where: { tournamentId } });
  if (existingMatchCount > 0) return { generated: false, alreadyGenerated: true, reason: 'EXISTING_BRACKET' };
  if (unsupportedPlayerCount(players.length)) {
    return { generated: false, alreadyGenerated: false, reason: 'DOUBLE_ELIMINATION_REQUIRES_3_TO_8_PLAYERS' };
  }

  const bracketSize = bracketSizeForPlayerCount(players.length);
  const plan = plans[bracketSize];
  const seededPlayers = seedPlayersWithByes(players, bracketSize);
  const matchesByKey = new Map();
  let matchNumber = 1;
  for (const match of plan) {
    const player1Id = match.players ? seededPlayers[match.players[0]]?.userId || null : null;
    const player2Id = match.players ? seededPlayers[match.players[1]]?.userId || null : null;
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

  await resolveDoubleEliminationByes({ db, tournamentId, playerCount: players.length });

  const resolvedMatches = await db.tournamentMatch.findMany({
    where: { tournamentId },
    orderBy: { matchNumber: 'asc' },
  });

  return {
    generated: true,
    alreadyGenerated: false,
    playerCount: players.length,
    bracketSize,
    matches: plan.map((match, index) => ({ ...resolvedMatches[index], key: match.key })),
  };
};

module.exports = { BRACKET_STAGES, bracketSizeForPlayerCount, doubleEliminationPlan, generateDoubleEliminationBracket, resolveDoubleEliminationByes, routingSlot, seedPlayersWithByes };
