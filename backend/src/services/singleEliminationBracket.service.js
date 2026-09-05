// Database-only implementation of the existing Single Elimination construction.
// The caller owns participant selection, deletion/regeneration policy, lifecycle,
// and HTTP/Socket.IO behavior. `db` may be Prisma or a Prisma transaction client.
const generateSingleEliminationBracket = async ({ db, tournamentId, players }) => {
  const nextPow2 = Math.pow(2, Math.ceil(Math.log2(players.length)));
  const totalRounds = Math.log2(nextPow2);
  let matchNum = 1;
  const createdRounds = [];

  for (let round = 1; round <= totalRounds; round++) {
    const matchesInRound = nextPow2 / Math.pow(2, round);
    const roundCreated = [];

    for (let i = 0; i < matchesInRound; i++) {
      let player1Id = null;
      let player2Id = null;
      let status = 'PENDING';
      let winnerId = null;

      if (round === 1) {
        const p1 = players[i * 2] || null;
        const p2 = players[i * 2 + 1] || null;
        player1Id = p1?.userId || null;
        player2Id = p2?.userId || null;

        if (player1Id && !player2Id) {
          status = 'BYE';
          winnerId = player1Id;
        }
      }

      const match = await db.tournamentMatch.create({
        data: {
          tournamentId,
          round,
          matchNumber: matchNum++,
          player1Id,
          player2Id,
          status,
          winnerId,
          nextMatchId: null,
        },
      });
      roundCreated.push(match);
    }
    createdRounds.push(roundCreated);
  }

  for (let r = 0; r < createdRounds.length - 1; r++) {
    const currentRound = createdRounds[r];
    const nextRound = createdRounds[r + 1];

    for (let i = 0; i < currentRound.length; i++) {
      const nextMatchIndex = Math.floor(i / 2);
      const nextMatch = nextRound[nextMatchIndex];
      if (nextMatch) {
        await db.tournamentMatch.update({
          where: { id: currentRound[i].id },
          data: { nextMatchId: nextMatch.id },
        });
      }
    }
  }

  if (createdRounds.length > 1) {
    const round1 = createdRounds[0];
    const round2 = createdRounds[1];

    for (let i = 0; i < round1.length; i++) {
      if (round1[i].status === 'BYE' && round1[i].winnerId) {
        const nextMatchIndex = Math.floor(i / 2);
        const nextMatch = round2[nextMatchIndex];
        if (nextMatch) {
          const current = await db.tournamentMatch.findUnique({
            where: { id: nextMatch.id },
          });
          const field = i % 2 === 0 ? 'player1Id' : 'player2Id';
          if (current[field] && current[field] !== round1[i].winnerId) {
            throw new Error('Single Elimination BYE destination slot is occupied by a different participant');
          }
          await db.tournamentMatch.update({
            where: { id: nextMatch.id },
            data: { [field]: round1[i].winnerId },
          });
        }
      }
    }
  }

  return createdRounds;
};

module.exports = { generateSingleEliminationBracket };
