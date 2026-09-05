const generateBrackets = async (req, res) => {
  const { tournamentId } = req.params;

  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        entries: {
          where: { status: { in: ['APPROVED', 'CHECKED_IN'] } },
          include: { user: { include: { gamifiedProfile: true } } },
        },
      },
    });

    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.entries.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 approved players to start' });
    }

    const players = [...tournament.entries].sort(() => Math.random() - 0.5);

    await prisma.tournamentMatch.deleteMany({ where: { tournamentId } });

    if (
      tournament.format === 'SINGLE_ELIMINATION' ||
      tournament.format === 'DOUBLE_ELIMINATION'
    ) {
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

          const match = await prisma.tournamentMatch.create({
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

      // Link nextMatchId
      for (let r = 0; r < createdRounds.length - 1; r++) {
        const currentRound = createdRounds[r];
        const nextRound = createdRounds[r + 1];

        for (let i = 0; i < currentRound.length; i++) {
          const nextMatchIndex = Math.floor(i / 2);
          const nextMatch = nextRound[nextMatchIndex];
          if (nextMatch) {
            await prisma.tournamentMatch.update({
              where: { id: currentRound[i].id },
              data: { nextMatchId: nextMatch.id },
            });
          }
        }
      }

      // Auto-advance BYE winners into Round 2
      if (createdRounds.length > 1) {
        const round1 = createdRounds[0];
        const round2 = createdRounds[1];

        for (let i = 0; i < round1.length; i++) {
          if (round1[i].status === 'BYE' && round1[i].winnerId) {
            const nextMatchIndex = Math.floor(i / 2);
            const nextMatch = round2[nextMatchIndex];
            if (nextMatch) {
              const current = await prisma.tournamentMatch.findUnique({
                where: { id: nextMatch.id },
              });
              await prisma.tournamentMatch.update({
                where: { id: nextMatch.id },
                data: {
                  player1Id: !current.player1Id ? round1[i].winnerId : current.player1Id,
                  player2Id:
                    current.player1Id && !current.player2Id
                      ? round1[i].winnerId
                      : current.player2Id,
                },
              });
            }
          }
        }
      }
    } else if (tournament.format === 'ROUND_ROBIN') {
      let matchNum = 1;
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          await prisma.tournamentMatch.create({
            data: {
              tournamentId,
              round: 1,
              matchNumber: matchNum++,
              player1Id: players[i].userId,
              player2Id: players[j].userId,
              status: 'PENDING',
            },
          });
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      await finalisePrizePool(tx, tournamentId);
      await tx.tournament.update({ where: { id: tournamentId }, data: { status: 'IN_PROGRESS' } });
    });

    // Debug log
    const debugMatches = await prisma.tournamentMatch.findMany({
      where: { tournamentId },
      orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }],
    });
    console.log('[DEBUG] All matches after bracket gen:');
    debugMatches.forEach((m) => {
      console.log(
        `  Round ${m.round} Match ${m.matchNumber}: ` +
          `p1=${m.player1Id ? m.player1Id.slice(0, 6) : 'NULL'} ` +
          `p2=${m.player2Id ? m.player2Id.slice(0, 6) : 'NULL'} ` +
          `status=${m.status} ` +
          `nextMatchId=${m.nextMatchId ? m.nextMatchId.slice(0, 6) : 'NULL'}`
      );
    });

    const fullTournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        matches: { orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }] },
        entries: { include: { user: { include: { gamifiedProfile: true } } } },
      },
    });

    const io = req.app.get('io');
    io.to(`tournament:${tournamentId}`).emit('tournament:bracketsGenerated', fullTournament);
    io.to('tv-display').emit('tournament:bracketsGenerated', fullTournament);

    res.json(fullTournament);
  } catch (err) {
    console.error('[Generate Brackets Error]', err);
    res.status(500).json({ error: 'Failed to generate brackets' });
  }
};
