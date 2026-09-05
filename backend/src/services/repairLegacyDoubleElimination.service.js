const { BRACKET_STAGES, doubleEliminationPlan, resolveDoubleEliminationByes } = require('./doubleEliminationBracket.service');

const conflict = (message) => Object.assign(new Error(message), { status: 409 });

const repairLegacyDoubleEliminationBracket = async ({ db, tournamentId }) => {
  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    include: { matches: { orderBy: { matchNumber: 'asc' } }, entries: { select: { userId: true } } },
  });
  if (!tournament) throw Object.assign(new Error('Tournament not found.'), { status: 404 });
  if (tournament.format !== 'DOUBLE_ELIMINATION') throw conflict('The selected tournament is not Double Elimination.');
  if (tournament.status === 'COMPLETED') throw conflict('A completed tournament cannot be structurally repaired.');

  const existing = tournament.matches;
  const bracketSize = existing.length === 3 ? 4 : existing.length === 7 ? 8 : null;
  const hasExplicitStructure = existing.some((match) => match.isLosers || match.isGrandFinal || match.isResetFinal || match.bracketStage === BRACKET_STAGES.LOSERS || match.bracketStage === BRACKET_STAGES.GRAND_FINAL || match.bracketStage === BRACKET_STAGES.RESET_FINAL || match.nextWinnerMatchId || match.nextLoserMatchId);
  if (!bracketSize || hasExplicitStructure) throw conflict('This is not a recognized legacy winners-only bracket. No changes were made.');
  if (tournament.entries.length < 3 || tournament.entries.length > bracketSize) throw conflict('The tournament entry count does not match the legacy bracket size.');
  if (existing.some((match, index) => match.matchNumber !== index + 1)) throw conflict('Legacy match numbering is not contiguous. No changes were made.');

  const plan = doubleEliminationPlan(bracketSize);
  const winnersCount = bracketSize - 1;
  const matchesByKey = new Map(plan.slice(0, winnersCount).map((definition, index) => [definition.key, { ...existing[index] }]));

  for (let index = winnersCount; index < plan.length; index += 1) {
    const definition = plan[index];
    const created = await db.tournamentMatch.create({
      data: {
        tournamentId,
        round: definition.round,
        matchNumber: index + 1,
        player1Id: null,
        player2Id: null,
        status: 'PENDING',
        nextMatchId: null,
        nextWinnerMatchId: null,
        nextLoserMatchId: null,
        bracketStage: definition.stage,
        isLosers: definition.stage === BRACKET_STAGES.LOSERS,
        isGrandFinal: !!definition.grandFinal,
        isResetFinal: !!definition.resetFinal,
      },
    });
    matchesByKey.set(definition.key, created);
  }

  for (const definition of plan) {
    const match = matchesByKey.get(definition.key);
    const winnerDestination = definition.winner ? matchesByKey.get(definition.winner[0]) : null;
    const loserDestination = definition.loser ? matchesByKey.get(definition.loser[0]) : null;
    const updated = await db.tournamentMatch.update({
      where: { id: match.id },
      data: {
        nextMatchId: winnerDestination?.id || null,
        nextWinnerMatchId: winnerDestination?.id || null,
        nextLoserMatchId: loserDestination?.id || null,
        bracketStage: definition.stage,
        isLosers: definition.stage === BRACKET_STAGES.LOSERS,
        isGrandFinal: !!definition.grandFinal,
        isResetFinal: !!definition.resetFinal,
      },
    });
    matchesByKey.set(definition.key, { ...match, ...updated });
  }

  const place = async (destinationKey, slot, participantId) => {
    if (!participantId || !destinationKey) return;
    const destination = matchesByKey.get(destinationKey);
    const field = slot === 1 ? 'player1Id' : 'player2Id';
    if (destination[field] && destination[field] !== participantId) throw conflict('Existing participant routing conflicts with the standard Double Elimination bracket. No changes were committed.');
    if (!destination[field]) {
      const updated = await db.tournamentMatch.update({ where: { id: destination.id }, data: { [field]: participantId } });
      matchesByKey.set(destinationKey, { ...destination, ...updated });
    }
  };

  for (const definition of plan.slice(0, winnersCount)) {
    const match = matchesByKey.get(definition.key);
    if (match.status === 'COMPLETED') {
      if (!match.winnerId || !match.player1Id || !match.player2Id) throw conflict('A completed legacy match is missing participants or a winner. No changes were committed.');
      const loserId = match.winnerId === match.player1Id ? match.player2Id : match.winnerId === match.player2Id ? match.player1Id : null;
      if (!loserId) throw conflict('A completed legacy match has an invalid winner. No changes were committed.');
      if (definition.winner) await place(definition.winner[0], definition.winner[1], match.winnerId);
      if (definition.loser) await place(definition.loser[0], definition.loser[1], loserId);
    } else if (match.status === 'BYE' && match.winnerId && definition.winner) {
      await place(definition.winner[0], definition.winner[1], match.winnerId);
    }
  }

  await resolveDoubleEliminationByes({ db, tournamentId, playerCount: bracketSize });
  return {
    tournamentId,
    repaired: true,
    preservedMatchIds: existing.map((match) => match.id),
    createdMatchCount: plan.length - existing.length,
    bracketSize,
  };
};

module.exports = { repairLegacyDoubleEliminationBracket };
