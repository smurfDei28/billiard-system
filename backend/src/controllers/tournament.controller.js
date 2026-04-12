const prisma = require('../config/prisma');
 
// Create tournament
const createTournament = async (req, res) => {
  const { name, description, format, maxPlayers, entryFee, prizePool, startDate, tableId } = req.body;
 
  if (!name || !format || !startDate) {
    return res.status(400).json({ error: 'name, format, and startDate are required' });
  }
 
  const validFormats = ['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN'];
  if (!validFormats.includes(format)) {
    return res.status(400).json({ error: `Format must be one of: ${validFormats.join(', ')}` });
  }
 
  try {
    const tournament = await prisma.tournament.create({
      data: {
        name,
        description: description || null,
        format,
        maxPlayers: maxPlayers || 16,
        entryFee: entryFee || 0,
        prizePool: prizePool || 0,
        startDate: new Date(startDate),
        tableId: tableId || null,
        createdBy: req.user.id,
        status: 'UPCOMING',
      },
    });
 
    // Notify all members
    const members = await prisma.user.findMany({ where: { role: 'MEMBER' } });
    await prisma.notification.createMany({
      data: members.map((m) => ({
        userId: m.id,
        type: 'TOURNAMENT_INVITE',
        title: `🏆 New Tournament: ${name}`,
        message: `A ${format.replace(/_/g, ' ')} tournament is now open for registration!`,
        data: { tournamentId: tournament.id },
      })),
    });
 
    const io = req.app.get('io');
    io.emit('tournament:created', tournament);
 
    res.status(201).json(tournament);
  } catch (err) {
    console.error('[Create Tournament Error]', err);
    res.status(500).json({ error: 'Failed to create tournament' });
  }
};
 
// Register for tournament (members only)
const registerForTournament = async (req, res) => {
  const { tournamentId } = req.params;
 
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { entries: true },
    });
 
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.status !== 'REGISTRATION_OPEN' && tournament.status !== 'UPCOMING') {
      return res.status(400).json({ error: 'Registration is closed' });
    }
    if (tournament.entries.length >= tournament.maxPlayers) {
      return res.status(400).json({ error: 'Tournament is full' });
    }
 
    const existing = tournament.entries.find((e) => e.userId === req.user.id);
    if (existing) return res.status(409).json({ error: 'Already registered' });
 
    const entry = await prisma.tournamentEntry.create({
      data: { tournamentId, userId: req.user.id },
      include: { user: { include: { gamifiedProfile: true } } },
    });
 
    const io = req.app.get('io');
    io.to(`tournament:${tournamentId}`).emit('tournament:newEntry', entry);
 
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: 'Failed to register' });
  }
};
 
// Generate brackets and start tournament
const generateBrackets = async (req, res) => {
  const { tournamentId } = req.params;
 
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        entries: {
          where: { status: { in: ['REGISTERED', 'CHECKED_IN'] } },
          include: { user: { include: { gamifiedProfile: true } } },
        },
      },
    });
 
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.entries.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 players to start' });
    }
 
    // Shuffle players randomly
    const players = [...tournament.entries].sort(() => Math.random() - 0.5);
 
    // Delete old matches if regenerating
    await prisma.tournamentMatch.deleteMany({ where: { tournamentId } });
 
    if (tournament.format === 'SINGLE_ELIMINATION' || tournament.format === 'DOUBLE_ELIMINATION') {
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
              // BYE — auto-advance p1
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
              // Re-fetch to get current state after any previous BYE fills
              const current = await prisma.tournamentMatch.findUnique({ where: { id: nextMatch.id } });
              await prisma.tournamentMatch.update({
                where: { id: nextMatch.id },
                data: {
                  player1Id: !current.player1Id ? round1[i].winnerId : current.player1Id,
                  player2Id: current.player1Id && !current.player2Id ? round1[i].winnerId : current.player2Id,
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
 
    // Update tournament status
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { status: 'IN_PROGRESS' },
    });
 
    // ── DEBUG: log all matches after bracket generation ──
const debugMatches = await prisma.tournamentMatch.findMany({
  where: { tournamentId },
  orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }],
});
console.log('[DEBUG] All matches after bracket gen:');
debugMatches.forEach(m => {
  console.log(
    `  Round ${m.round} Match ${m.matchNumber}: ` +
    `p1=${m.player1Id ? m.player1Id.slice(0,6) : 'NULL'} ` +
    `p2=${m.player2Id ? m.player2Id.slice(0,6) : 'NULL'} ` +
    `status=${m.status} ` +
    `nextMatchId=${m.nextMatchId ? m.nextMatchId.slice(0,6) : 'NULL'}`
  );
});
// ── END DEBUG ──



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
 
// Report match result — advances winner to next round
const reportMatchResult = async (req, res) => {
  const { matchId } = req.params;
  const { player1Score, player2Score, winnerId } = req.body;
 
  try {
    // ── Step 1: Fetch the match FIRST so we have tournamentId and nextMatchId ──
    const existingMatch = await prisma.tournamentMatch.findUnique({
      where: { id: matchId },
    });
 
    if (!existingMatch) {
      return res.status(404).json({ error: 'Match not found' });
    }
 
    if (existingMatch.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Match already completed' });
    }
 
    // ── Step 2: Mark match as COMPLETED ──
    const match = await prisma.tournamentMatch.update({
      where: { id: matchId },
      data: {
        player1Score,
        player2Score,
        winnerId,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
 
    // ── Step 3: Advance winner to next match ──────────────────────────────
    if (match.nextMatchId && winnerId) {
      // Re-fetch nextMatch from DB (not stale in-memory data)
      const nextMatch = await prisma.tournamentMatch.findUnique({
        where: { id: match.nextMatchId },
      });
 
      if (nextMatch && nextMatch.status !== 'COMPLETED') {
        const updateData = {};
 
        if (!nextMatch.player1Id) {
          updateData.player1Id = winnerId;
        } else if (!nextMatch.player2Id) {
          updateData.player2Id = winnerId;
        }
        // Edge case: both slots filled (shouldn't happen in normal flow, but guard it)
        // If somehow both are filled, player1Id takes precedence and we log a warning
        if (Object.keys(updateData).length === 0) {
          console.warn(
            `[Bracket Advance] nextMatch ${match.nextMatchId} already has both players filled. ` +
            `Winner ${winnerId} could not be slotted.`
          );
        } else {
          await prisma.tournamentMatch.update({
            where: { id: match.nextMatchId },
            data: updateData,
          });
        }
      }
    }
 
    // ── Step 4: Update gamified profiles ──────────────────────────────────
    if (winnerId) {
      const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id;
 
      await prisma.gamifiedProfile.update({
        where: { userId: winnerId },
        data: {
          totalWins: { increment: 1 },
          totalGames: { increment: 1 },
          xp: { increment: 75 },
          winStreak: { increment: 1 },
        },
      });
 
      if (loserId) {
        await prisma.gamifiedProfile.update({
          where: { userId: loserId },
          data: {
            totalLosses: { increment: 1 },
            totalGames: { increment: 1 },
            winStreak: 0,
          },
        });
      }
    }
 
    // ── Step 5: Check if tournament is complete ────────────────────────────
    // Re-fetch ALL matches fresh from DB (after all updates above are committed)
    const allMatches = await prisma.tournamentMatch.findMany({
      where: { tournamentId: match.tournamentId },
    });
 
    // A match is "pending" if it still needs to be played:
    // - PENDING with both players assigned = needs to be played
    // - PENDING with missing player(s) = waiting for bracket advancement (not stuck)
    // Tournament is complete only when no PENDING matches with both players remain
    // AND no matches are left completely unresolved
    const incompletedMatches = allMatches.filter(
      (m) => m.status !== 'COMPLETED' && m.status !== 'BYE'
    );
 
    // A match that is PENDING but missing a player is still "in progress" (waiting for someone to advance)
    // Only mark tournament complete when ALL non-BYE matches are COMPLETED
    if (incompletedMatches.length === 0) {
      await prisma.tournament.update({
        where: { id: match.tournamentId },
        data: { status: 'COMPLETED', endDate: new Date() },
      });
 
      if (winnerId) {
        await prisma.tournamentEntry.updateMany({
          where: { tournamentId: match.tournamentId, userId: winnerId },
          data: { status: 'WINNER' },
        });
 
        // Loyalty reward for tournament win
        await prisma.loyaltyHistory.create({
          data: {
            userId: winnerId,
            trigger: 'TOURNAMENT_WIN',
            creditsAwarded: 60,
            description: 'Tournament winner reward — 1 free hour',
          },
        });
 
        const membership = await prisma.membership.findUnique({
          where: { userId: winnerId },
        });
        if (membership) {
          await prisma.membership.update({
            where: { userId: winnerId },
            data: { creditBalance: { increment: 60 } },
          });
        }
      }
    }
 
    // ── DEBUG: log match advancement ──
console.log('[DEBUG] Match completed:', {
  matchId: match.id.slice(0,6),
  winnerId: winnerId ? winnerId.slice(0,6) : 'NULL',
  nextMatchId: match.nextMatchId ? match.nextMatchId.slice(0,6) : 'NULL',
});
if (match.nextMatchId) {
  const checkNext = await prisma.tournamentMatch.findUnique({
    where: { id: match.nextMatchId },
  });
  console.log('[DEBUG] Next match after update:', {
    id: checkNext?.id.slice(0,6),
    p1: checkNext?.player1Id ? checkNext.player1Id.slice(0,6) : 'NULL',
    p2: checkNext?.player2Id ? checkNext.player2Id.slice(0,6) : 'NULL',
    status: checkNext?.status,
  });
}
// ── END DEBUG ──
    // ── Step 6: Fetch full updated tournament AFTER all DB writes ──────────
    const updatedTournament = await prisma.tournament.findUnique({
      where: { id: match.tournamentId },
      include: {
        matches: { orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }] },
        entries: { include: { user: { include: { gamifiedProfile: true } } } },
      },
    });
 
    // ── Step 7: Emit real-time updates ────────────────────────────────────
    const io = req.app.get('io');
    io.to(`tournament:${match.tournamentId}`).emit('match:completed', updatedTournament);
    io.to('tv-display').emit('match:completed', updatedTournament);
 
    res.json({ match, tournament: updatedTournament });
  } catch (err) {
    console.error('[Report Match Result Error]', err);
    res.status(500).json({ error: 'Failed to report result' });
  }
};
 
// Get tournament with full bracket
const getTournament = async (req, res) => {
  const { tournamentId } = req.params;
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        matches: {
          orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }],
        },
        entries: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                gamifiedProfile: true,
              },
            },
          },
        },
      },
    });
 
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    res.json(tournament);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tournament' });
  }
};
 
// List all tournaments
const listTournaments = async (req, res) => {
  try {
    const tournaments = await prisma.tournament.findMany({
      orderBy: { startDate: 'desc' },
      include: {
        _count: { select: { entries: true } },
      },
    });
    res.json(tournaments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tournaments' });
  }
};
 
module.exports = {
  createTournament,
  registerForTournament,
  generateBrackets,
  reportMatchResult,
  getTournament,
  listTournaments,
};