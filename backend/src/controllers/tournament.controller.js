const prisma = require('../config/prisma');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calculate estimated tournament duration in minutes.
 * Based on format, player count, and average match time per game type.
 */
const calcEstimatedDuration = (format, playerCount, gameType) => {
  // Average minutes per match by game type
  const avgMatchMinutes = {
    EIGHT_BALL: 25,
    NINE_BALL: 20,
    TEN_BALL: 30,
  };
  const avg = avgMatchMinutes[gameType] || 25;

  if (format === 'ROUND_ROBIN') {
    // n*(n-1)/2 matches, all run in parallel pairs — rough estimate
    const totalMatches = (playerCount * (playerCount - 1)) / 2;
    // Assume 2 tables running concurrently
    return Math.ceil((totalMatches / 2) * avg);
  }

  if (format === 'DOUBLE_ELIMINATION') {
    const rounds = Math.ceil(Math.log2(playerCount));
    return rounds * 2 * avg; // winners + losers brackets
  }

  // SINGLE_ELIMINATION: log2(playerCount) rounds
  const rounds = Math.ceil(Math.log2(playerCount));
  return rounds * avg;
};

/**
 * Send a push/in-app notification to a user.
 * All notification sends go through this helper so they never crash the main flow.
 */
const notify = async (userId, type, title, message, data = {}) => {
  try {
    await prisma.notification.create({
      data: { userId, type, title, message, data },
    });
  } catch (err) {
    console.error('[Notify Error]', err.message);
  }
};

// ─── Create Tournament (Admin only) ──────────────────────────────────────────

const createTournament = async (req, res) => {
  const {
    name,
    description,
    format,
    gameType,
    maxPlayers,
    entryFee,
    prizePool,
    startDate,   // ISO string — must include time
    tableId,
  } = req.body;

  if (!name || !format || !startDate || !gameType) {
    return res.status(400).json({ error: 'name, format, gameType, and startDate are required' });
  }

  const validFormats = ['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN'];
  if (!validFormats.includes(format)) {
    return res.status(400).json({ error: `format must be one of: ${validFormats.join(', ')}` });
  }

  const validGameTypes = ['EIGHT_BALL', 'NINE_BALL', 'TEN_BALL'];
  if (!validGameTypes.includes(gameType)) {
    return res.status(400).json({ error: `gameType must be one of: ${validGameTypes.join(', ')}` });
  }

  // Must be at least 3 days from now
  const start = new Date(startDate);
  const minStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  if (start < minStart) {
    return res.status(400).json({
      error: 'Tournament must be scheduled at least 3 days in advance.',
    });
  }

  try {
    const players = parseInt(maxPlayers) || 16;
    const estimatedDuration = calcEstimatedDuration(format, players, gameType);

    const tournament = await prisma.tournament.create({
      data: {
        name,
        description: description || null,
        format,
        gameType,
        maxPlayers: players,
        entryFee: parseFloat(entryFee) || 0,
        prizePool: parseFloat(prizePool) || 0,
        startDate: start,
        estimatedDuration,
        tableId: tableId || null,
        createdBy: req.user.id,
        status: 'UPCOMING',
      },
    });

    // Notify all members
    const members = await prisma.user.findMany({ where: { role: 'MEMBER' } });
    const gameLabel = { EIGHT_BALL: '8-Ball', NINE_BALL: '9-Ball', TEN_BALL: '10-Ball' }[gameType];
    await prisma.notification.createMany({
      data: members.map((m) => ({
        userId: m.id,
        type: 'TOURNAMENT_INVITE',
        title: `🏆 New Tournament: ${name}`,
        message: `A ${gameLabel} ${format.replace(/_/g, ' ')} tournament is now open for registration!`,
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

// ─── Member: Request to Join Tournament ──────────────────────────────────────
// Creates a PENDING_PAYMENT entry. Admin must approve after payment is confirmed.

const registerForTournament = async (req, res) => {
  const { tournamentId } = req.params;
  const { paymentMethod, paymentRef } = req.body; // optional at this stage

  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        entries: {
          where: { status: { notIn: ['CANCELLED'] } },
        },
      },
    });

    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    if (
      tournament.status !== 'REGISTRATION_OPEN' &&
      tournament.status !== 'UPCOMING'
    ) {
      return res.status(400).json({ error: 'Registration is currently closed for this tournament' });
    }

    if (tournament.entries.length >= tournament.maxPlayers) {
      return res.status(400).json({ error: 'This tournament is already full' });
    }

    const existing = tournament.entries.find((e) => e.userId === req.user.id);
    if (existing) {
      return res.status(409).json({ error: 'You are already registered for this tournament' });
    }

    // If there's an entry fee, member must supply payment details
    const hasFee = tournament.entryFee > 0;

    let entryStatus = 'PENDING_PAYMENT';
    let paidAt = null;

    if (hasFee && paymentMethod) {
      // Payment details provided at registration time
      entryStatus = 'PENDING_APPROVAL';
      paidAt = new Date();
    } else if (!hasFee) {
      // Free tournament — goes straight to PENDING_APPROVAL
      entryStatus = 'PENDING_APPROVAL';
    }

    const entry = await prisma.tournamentEntry.create({
      data: {
        tournamentId,
        userId: req.user.id,
        status: entryStatus,
        paymentMethod: paymentMethod || null,
        paymentRef: paymentRef || null,
        paidAt,
      },
      include: { user: { include: { gamifiedProfile: true } } },
    });

    // Notify the member that registration is pending
    if (entryStatus === 'PENDING_PAYMENT') {
      await notify(
        req.user.id,
        'TOURNAMENT_PAYMENT',
        '📋 Registration Received',
        `You have been registered for "${tournament.name}". Please pay the ₱${tournament.entryFee} entry fee and submit your payment reference to complete your registration.`,
        { tournamentId }
      );
    } else {
      await notify(
        req.user.id,
        'TOURNAMENT_PAYMENT',
        '⏳ Registration Pending Approval',
        `Your registration for "${tournament.name}" is pending admin approval. You will be notified once confirmed.`,
        { tournamentId }
      );
    }

    // Notify admins
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    await prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        type: 'TOURNAMENT_PAYMENT',
        title: '📋 New Tournament Registration',
        message: `${entry.user.firstName} ${entry.user.lastName} has registered for "${tournament.name}". Status: ${entryStatus.replace(/_/g, ' ')}.`,
        data: { tournamentId, entryId: entry.id, userId: req.user.id },
      })),
    });

    const io = req.app.get('io');
    io.to(`tournament:${tournamentId}`).emit('tournament:newEntry', entry);

    res.status(201).json(entry);
  } catch (err) {
    console.error('[Register For Tournament Error]', err);
    res.status(500).json({ error: 'Failed to register for tournament' });
  }
};

// ─── Admin: Approve Tournament Entry ─────────────────────────────────────────

const approveEntry = async (req, res) => {
  const { entryId } = req.params;

  try {
    const entry = await prisma.tournamentEntry.findUnique({
      where: { id: entryId },
      include: { tournament: true, user: true },
    });

    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    if (entry.status === 'APPROVED') {
      return res.status(400).json({ error: 'Entry is already approved' });
    }
    if (entry.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Cannot approve a cancelled entry' });
    }

    const updated = await prisma.tournamentEntry.update({
      where: { id: entryId },
      data: {
        status: 'APPROVED',
        approvedBy: req.user.id,
        approvedAt: new Date(),
      },
    });

    // Notify the member
    await notify(
      entry.userId,
      'TOURNAMENT_APPROVED',
      '✅ Tournament Registration Approved',
      `Your registration for "${entry.tournament.name}" has been approved! See you on ${new Date(entry.tournament.startDate).toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}.`,
      { tournamentId: entry.tournamentId, entryId }
    );

    // Log staff action
    await prisma.staffAction.create({
      data: {
        staffId: req.user.id,
        action: 'APPROVE_TOURNAMENT_ENTRY',
        targetId: entry.userId,
        details: { entryId, tournamentId: entry.tournamentId },
      },
    });

    const io = req.app.get('io');
    io.to(`tournament:${entry.tournamentId}`).emit('tournament:entryApproved', updated);

    res.json({ message: 'Entry approved successfully', entry: updated });
  } catch (err) {
    console.error('[Approve Entry Error]', err);
    res.status(500).json({ error: 'Failed to approve entry' });
  }
};

// ─── Admin: Cancel Tournament Entry ──────────────────────────────────────────

const cancelEntry = async (req, res) => {
  const { entryId } = req.params;
  const { cancelNote } = req.body;

  try {
    const entry = await prisma.tournamentEntry.findUnique({
      where: { id: entryId },
      include: { tournament: true, user: true },
    });

    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    if (entry.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Entry is already cancelled' });
    }

    const updated = await prisma.tournamentEntry.update({
      where: { id: entryId },
      data: {
        status: 'CANCELLED',
        cancelledBy: req.user.id,
        cancelledAt: new Date(),
        cancelNote: cancelNote || null,
      },
    });

    // Notify the member — no refund policy
    await notify(
      entry.userId,
      'TOURNAMENT_CANCELLED',
      '❌ Tournament Registration Cancelled',
      `Your registration for "${entry.tournament.name}" has been cancelled by the organizer.${cancelNote ? ` Reason: ${cancelNote}` : ''} Please note that entry fees are non-refundable.`,
      { tournamentId: entry.tournamentId, entryId }
    );

    await prisma.staffAction.create({
      data: {
        staffId: req.user.id,
        action: 'CANCEL_TOURNAMENT_ENTRY',
        targetId: entry.userId,
        details: { entryId, tournamentId: entry.tournamentId, cancelNote },
      },
    });

    const io = req.app.get('io');
    io.to(`tournament:${entry.tournamentId}`).emit('tournament:entryCancelled', updated);

    res.json({ message: 'Entry cancelled', entry: updated });
  } catch (err) {
    console.error('[Cancel Entry Error]', err);
    res.status(500).json({ error: 'Failed to cancel entry' });
  }
};

// ─── Generate Brackets (Admin only) ──────────────────────────────────────────

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

    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { status: 'IN_PROGRESS' },
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

// ─── Report Match Result ──────────────────────────────────────────────────────

const reportMatchResult = async (req, res) => {
  const { matchId } = req.params;
  const { player1Score, player2Score, winnerId } = req.body;

  try {
    const existingMatch = await prisma.tournamentMatch.findUnique({
      where: { id: matchId },
    });

    if (!existingMatch) return res.status(404).json({ error: 'Match not found' });
    if (existingMatch.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Match already completed' });
    }

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

    // Advance winner to next match
    if (match.nextMatchId && winnerId) {
      const nextMatch = await prisma.tournamentMatch.findUnique({
        where: { id: match.nextMatchId },
      });

      if (nextMatch && nextMatch.status !== 'COMPLETED') {
        const updateData = {};
        if (!nextMatch.player1Id) {
          updateData.player1Id = winnerId;
        } else if (!nextMatch.player2Id) {
          updateData.player2Id = winnerId;
        } else {
          console.warn(
            `[Bracket Advance] nextMatch ${match.nextMatchId} already has both players. Winner ${winnerId} not slotted.`
          );
        }
        if (Object.keys(updateData).length > 0) {
          await prisma.tournamentMatch.update({
            where: { id: match.nextMatchId },
            data: updateData,
          });
        }
      }
    }

    // Update gamified profiles
    if (winnerId) {
      const loserId =
        match.player1Id === winnerId ? match.player2Id : match.player1Id;

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

    // Check if tournament is complete
    const allMatches = await prisma.tournamentMatch.findMany({
      where: { tournamentId: match.tournamentId },
    });

    const incompletedMatches = allMatches.filter(
      (m) => m.status !== 'COMPLETED' && m.status !== 'BYE'
    );

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

    // Debug log
    console.log('[DEBUG] Match completed:', {
      matchId: match.id.slice(0, 6),
      winnerId: winnerId ? winnerId.slice(0, 6) : 'NULL',
      nextMatchId: match.nextMatchId ? match.nextMatchId.slice(0, 6) : 'NULL',
    });
    if (match.nextMatchId) {
      const checkNext = await prisma.tournamentMatch.findUnique({
        where: { id: match.nextMatchId },
      });
      console.log('[DEBUG] Next match after update:', {
        id: checkNext?.id.slice(0, 6),
        p1: checkNext?.player1Id ? checkNext.player1Id.slice(0, 6) : 'NULL',
        p2: checkNext?.player2Id ? checkNext.player2Id.slice(0, 6) : 'NULL',
        status: checkNext?.status,
      });
    }

    const updatedTournament = await prisma.tournament.findUnique({
      where: { id: match.tournamentId },
      include: {
        matches: { orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }] },
        entries: { include: { user: { include: { gamifiedProfile: true } } } },
      },
    });

    const io = req.app.get('io');
    io.to(`tournament:${match.tournamentId}`).emit('match:completed', updatedTournament);
    io.to('tv-display').emit('match:completed', updatedTournament);

    res.json({ match, tournament: updatedTournament });
  } catch (err) {
    console.error('[Report Match Result Error]', err);
    res.status(500).json({ error: 'Failed to report result' });
  }
};

// ─── Get Tournament ───────────────────────────────────────────────────────────

const getTournament = async (req, res) => {
  const { tournamentId } = req.params;
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        matches: { orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }] },
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

// ─── List Tournaments ─────────────────────────────────────────────────────────

const listTournaments = async (req, res) => {
  try {
    const tournaments = await prisma.tournament.findMany({
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { entries: true } } },
    });
    res.json(tournaments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tournaments' });
  }
};

// ─── List Pending Entries (for admin approval panel) ─────────────────────────

const listPendingEntries = async (req, res) => {
  const { tournamentId } = req.params;
  try {
    const entries = await prisma.tournamentEntry.findMany({
      where: {
        tournamentId,
        status: { in: ['PENDING_PAYMENT', 'PENDING_APPROVAL'] },
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            gamifiedProfile: true,
          },
        },
      },
      orderBy: { registeredAt: 'asc' },
    });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pending entries' });
  }
};

module.exports = {
  createTournament,
  registerForTournament,
  approveEntry,
  cancelEntry,
  generateBrackets,
  reportMatchResult,
  getTournament,
  listTournaments,
  listPendingEntries,
};
