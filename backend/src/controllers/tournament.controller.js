const prisma = require('../config/prisma');
const { settlePendingCancellationFees } = require('../utils/cancellationFees');
const { closeTournamentRegistration } = require('../services/tournamentRegistration.service');
const { generateSingleEliminationBracket } = require('../services/singleEliminationBracket.service');
const { generateDoubleEliminationBracket } = require('../services/doubleEliminationBracket.service');
const { completeTournamentMatch } = require('../services/tournamentMatchResult.service');
const { scheduleTournamentMatch, assignTournamentTable, setupTournamentMatch, startTournamentMatch } = require('../services/tournamentMatchOperations.service');
const { markTournamentPrizePaid } = require('../services/tournamentPayout.service');
const { formatLabel, localTime, notifyTournamentUsers, participantName } = require('../services/tournamentNotification.service');

// Entries eligible to occupy a tournament slot. Payment submissions awaiting
// verification intentionally do not consume a slot or enter a bracket.
const ACTIVE_ENTRY_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'CHECKED_IN', 'WINNER'];
const NEW_TOURNAMENT_REGISTRATION_PAYMENT_METHODS = ['CREDITS', 'CASH'];
const paidEntryWhere = { paidAt: { not: null } };
const OPERATION_TRANSACTION_OPTIONS = { maxWait: 10000, timeout: 20000 };
const sendTournamentOperationError = (res, err, fallback, context) => {
  console.error(`[Tournament ${context} Error]`, { code: err.code, message: err.message });
  if (err.code === 'P2024') return res.status(503).json({ error: 'The server is busy. Please wait a moment and try again.' });
  if (err.code === 'P2034') return res.status(409).json({ error: 'Another match update happened at the same time. Refresh and try again.' });
  return res.status(err.status || 500).json({ error: err.status ? err.message : fallback });
};
const decorateTournament = async (tournament, precomputedCounts = null) => {
  const [activePlayerCount, paidRegistrationCount] = precomputedCounts
    ? [precomputedCounts.activePlayerCount || 0, precomputedCounts.paidRegistrationCount || 0]
    : await Promise.all([
      prisma.tournamentEntry.count({ where: { tournamentId: tournament.id, status: { in: ACTIVE_ENTRY_STATUSES } } }),
      prisma.tournamentEntry.count({ where: { tournamentId: tournament.id, ...paidEntryWhere } }),
    ]);
  const calculatedPrizePool = paidRegistrationCount * Number(tournament.entryFee || 0);
  const finalized = ['REGISTRATION_CLOSED', 'IN_PROGRESS', 'COMPLETED'].includes(tournament.status);
  return { ...tournament, activePlayerCount, paidRegistrationCount, availableSlots: Math.max(0, tournament.maxPlayers - activePlayerCount), prizePool: finalized && tournament.finalPrizePool != null ? tournament.finalPrizePool : calculatedPrizePool };
};
const finalisePrizePool = async (tx, tournamentId) => {
  const tournament = await tx.tournament.findUnique({ where: { id: tournamentId }, select: { entryFee: true } });
  const paidRegistrationCount = await tx.tournamentEntry.count({ where: { tournamentId, ...paidEntryWhere } });
  return tx.tournament.update({ where: { id: tournamentId }, data: { finalPrizePool: paidRegistrationCount * Number(tournament?.entryFee || 0) } });
};

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

// Estimated duration is planning information only. A tournament can complete
// only when its resolving bracket match is recorded.
const syncTournamentLifecycle = async () => {
  const now = new Date();
  const active = await prisma.tournament.findMany({
    where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
    select: { id: true, startDate: true, estimatedDuration: true, status: true },
  });
  await Promise.all(active.map(async (tournament) => {
    const start = new Date(tournament.startDate);
    if (start > now) {
      if (tournament.status === 'UPCOMING') await prisma.tournament.update({ where: { id: tournament.id }, data: { status: 'REGISTRATION_OPEN' } });
      return;
    }
    // Registration closing/bracket generation owns the transition to
    // IN_PROGRESS. Do not infer state or completion from elapsed time here.
  }));
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

const loadTournamentMatchNotificationContext = async (matchId) => {
  const match = await prisma.tournamentMatch.findUnique({
    where: { id: matchId },
    include: {
      tournament: { include: { entries: { include: { user: { include: { gamifiedProfile: true } } } } } },
    },
  });
  const table = match?.tableId ? await prisma.billiardTable.findUnique({ where: { id: match.tableId }, select: { tableNumber: true } }) : null;
  return { match, table };
};

const getCancellationFee = async (tournament) => {
  const table = tournament.tableId
    ? await prisma.billiardTable.findUnique({ where: { id: tournament.tableId } })
    : await prisma.billiardTable.findFirst({ orderBy: { tableNumber: 'asc' } });
  const amount = tournament.format === 'DOUBLE_ELIMINATION' ? 400 : 200;
  return { hourlyRate: null, reservedHours: null, amount };
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
    registrationDeadline,
    tableId,
    raceTo,
  } = req.body;

  if (!name || !format || !startDate || !gameType || !registrationDeadline) {
    return res.status(400).json({ error: 'name, format, gameType, registrationDeadline, and startDate are required' });
  }

  const validFormats = ['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION'];
  if (!validFormats.includes(format)) {
    return res.status(400).json({ error: `format must be one of: ${validFormats.join(', ')}` });
  }

  const validGameTypes = ['EIGHT_BALL', 'NINE_BALL', 'TEN_BALL'];
  if (!validGameTypes.includes(gameType)) {
    return res.status(400).json({ error: `gameType must be one of: ${validGameTypes.join(', ')}` });
  }

  const players = parseInt(maxPlayers, 10) || 16;
  if (format === 'DOUBLE_ELIMINATION' && (players < 3 || players > 8)) {
    return res.status(400).json({ error: 'Double Elimination supports 3 to 8 players.' });
  }
  const parsedRaceTo = Number(raceTo ?? 5);
  if (!Number.isInteger(parsedRaceTo) || parsedRaceTo < 1 || parsedRaceTo > 99) return res.status(400).json({ error: 'Race To must be a whole number from 1 to 99.' });
  const parsedEntryFee = parseFloat(entryFee) || 0;

  // Must be at least 3 days from now
  const start = new Date(startDate);
  const deadline = new Date(registrationDeadline);
  if (Number.isNaN(start.getTime()) || Number.isNaN(deadline.getTime()) || deadline >= start) return res.status(400).json({ error: 'Registration deadline must be a valid time before the tournament start.' });
  const minStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const allowTestMode = String(process.env.ALLOW_TOURNAMENT_TEST_MODE || '').toLowerCase() === 'true';
  const isTestMode = !!req.body?.testMode;
  if (start < minStart && !(allowTestMode && isTestMode)) {
    return res.status(400).json({
      error: 'Tournament must be scheduled at least 3 days in advance.',
    });
  }

  try {
    const estimatedDuration = calcEstimatedDuration(format, players, gameType);

    const tournament = await prisma.tournament.create({
      data: {
        name,
        description: description || null,
        format,
        gameType,
        maxPlayers: players,
        entryFee: parsedEntryFee,
        prizePool: 0,
        raceTo: parsedRaceTo,
        startDate: start,
        registrationDeadline: deadline,
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

const closeRegistration = async (req, res) => {
  try { res.json(await closeTournamentRegistration(req.params.tournamentId)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message || 'Failed to close registration' }); }
};

const scheduleMatch = async (req, res) => {
  try {
    const previous = await prisma.tournamentMatch.findUnique({ where: { id: req.params.matchId }, select: { scheduledAt: true } });
    const result = await prisma.$transaction((db) => scheduleTournamentMatch({ db, matchId: req.params.matchId, scheduledAt: req.body.scheduledAt }), OPERATION_TRANSACTION_OPTIONS);
    const { match, table } = await loadTournamentMatchNotificationContext(result.id);
    if (match && (!previous?.scheduledAt || new Date(previous.scheduledAt).getTime() !== new Date(match.scheduledAt).getTime())) {
      const p1 = participantName(match.tournament.entries, match.player1Id);
      const p2 = participantName(match.tournament.entries, match.player2Id);
      await notifyTournamentUsers({ db: prisma, userIds: [match.player1Id, match.player2Id], title: 'Tournament Match Scheduled', message: `${match.tournament.name}: ${p1} vs ${p2} is scheduled for ${localTime(match.scheduledAt)}${table ? ` at Table ${table.tableNumber}` : ''}. Race To ${match.tournament.raceTo}.`, data: { tournamentId: match.tournamentId, matchId: match.id } });
    }
    const io = req.app.get('io');
    io.to(`tournament:${result.tournamentId}`).emit('match:updated', result);
    io.to('tv-display').emit('match:updated', result);
    res.json(result);
  }
  catch (err) { sendTournamentOperationError(res, err, 'Failed to schedule match', 'Schedule Match'); }
};
const assignMatchTable = async (req, res) => {
  try {
    const previous = await prisma.tournamentMatch.findUnique({ where: { id: req.params.matchId }, select: { tableId: true } });
    const result = await prisma.$transaction((db) => assignTournamentTable({ db, matchId: req.params.matchId, tableId: req.body.tableId }), OPERATION_TRANSACTION_OPTIONS);
    const { match, table } = await loadTournamentMatchNotificationContext(result.id);
    if (match && previous?.tableId !== match.tableId) await notifyTournamentUsers({ db: prisma, userIds: [match.player1Id, match.player2Id], title: 'Tournament Table Assigned', message: `${match.tournament.name}: your match is assigned to Table ${table?.tableNumber || 'TBD'}. Race To ${match.tournament.raceTo}.`, data: { tournamentId: match.tournamentId, matchId: match.id, tableId: match.tableId } });
    const io = req.app.get('io');
    io.to(`tournament:${result.tournamentId}`).emit('match:updated', result);
    io.to('tv-display').emit('match:updated', result);
    res.json(result);
  }
  catch (err) { sendTournamentOperationError(res, err, 'Failed to assign table', 'Assign Table'); }
};
const setupMatch = async (req, res) => {
  try {
    const result = await prisma.$transaction(
      (db) => setupTournamentMatch({ db, matchId: req.params.matchId, tableId: req.body.tableId, scheduledAt: req.body.scheduledAt }),
      { ...OPERATION_TRANSACTION_OPTIONS, isolationLevel: 'Serializable' },
    );
    const { match, table } = await loadTournamentMatchNotificationContext(result.id);
    if (match) {
      const p1 = participantName(match.tournament.entries, match.player1Id);
      const p2 = participantName(match.tournament.entries, match.player2Id);
      await notifyTournamentUsers({ db: prisma, userIds: [match.player1Id, match.player2Id], title: 'Tournament Match Setup Updated', message: `${match.tournament.name}: ${p1} vs ${p2} is scheduled for ${localTime(match.scheduledAt)} at Table ${table?.tableNumber || 'TBD'}. Race To ${match.tournament.raceTo}.`, data: { tournamentId: match.tournamentId, matchId: match.id, tableId: match.tableId } });
    }
    const io = req.app.get('io');
    io.to(`tournament:${result.tournamentId}`).emit('match:updated', result);
    io.to('tv-display').emit('match:updated', result);
    res.json(result);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'This table already has a match scheduled at that time' });
    sendTournamentOperationError(res, err, 'Failed to save match setup', 'Match Setup');
  }
};
const startMatch = async (req, res) => {
  try {
    const result = await prisma.$transaction((db) => startTournamentMatch({ db, matchId: req.params.matchId }), OPERATION_TRANSACTION_OPTIONS);
    const io = req.app.get('io');
    if (!result.alreadyStarted) {
      const { match, table } = await loadTournamentMatchNotificationContext(result.match.id);
      if (match) await notifyTournamentUsers({ db: prisma, userIds: [match.player1Id, match.player2Id], title: 'Tournament Match LIVE', message: `${match.tournament.name}: your match is now LIVE${table ? ` at Table ${table.tableNumber}` : ''}. Race To ${match.tournament.raceTo}.`, data: { tournamentId: match.tournamentId, matchId: match.id, tableId: match.tableId } });
      io.to(`tournament:${result.match.tournamentId}`).emit('match:started', result.match);
      io.to('tv-display').emit('match:started', result.match);
      io.to('staff-tablet').emit('table:updated', { tableId: result.match.tableId, status: 'OCCUPIED' });
      io.to('tv-display').emit('table:updated', { tableId: result.match.tableId, status: 'OCCUPIED' });
    }
    res.json(result);
  } catch (err) { sendTournamentOperationError(res, err, 'Failed to start match', 'Start Match'); }
};

const markPrizePaid = async (req, res) => {
  const { tournamentId } = req.params;
  try {
    const result = await prisma.$transaction(
      (db) => markTournamentPrizePaid({ db, tournamentId, adminId: req.user.id, note: req.body?.note }),
      { isolationLevel: 'Serializable' },
    );
    res.json(result);
  } catch (err) {
    // The one-payout-per-tournament constraint is the final concurrency guard.
    // A concurrent repeat is an idempotent already-paid response, not a second cash event.
    if (err.code === 'P2002') {
      const payout = await prisma.tournamentPayout.findUnique({ where: { tournamentId } });
      if (payout) return res.json({ payout, alreadyPaid: true });
    }
    res.status(err.status || 500).json({ error: err.message || 'Failed to mark tournament prize as paid' });
  }
};

// ─── Member: Request to Join Tournament ──────────────────────────────────────
// Creates a PENDING_PAYMENT entry. Admin must approve after payment is confirmed.

const registerForTournament = async (req, res) => {
  const { tournamentId } = req.params;
  const { paymentMethod } = req.body; // optional at this stage

  try {
    const pendingFee = await prisma.tournamentEntry.findFirst({ where: { userId: req.user.id, cancellationFeeStatus: 'PENDING', cancellationFee: { gt: 0 } }, orderBy: { cancelledAt: 'asc' } });
    if (pendingFee) {
      return res.status(403).json({
        error: `You have a pending tournament cancellation fee of ${Number(pendingFee.cancellationFee).toFixed(2)} credits. Top up enough credits for automatic settlement before joining another tournament.`,
        code: 'CANCELLATION_FEE_PENDING',
        cancellationFee: pendingFee.cancellationFee,
      });
    }

    const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });

    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    if (
      tournament.status !== 'REGISTRATION_OPEN' &&
      tournament.status !== 'UPCOMING'
    ) {
      return res.status(400).json({ error: 'Registration is currently closed for this tournament' });
    }

    const activePlayerCount = await prisma.tournamentEntry.count({ where: { tournamentId, status: { in: ACTIVE_ENTRY_STATUSES } } });
    if (activePlayerCount >= tournament.maxPlayers) {
      return res.status(400).json({ error: 'This tournament is already full' });
    }

    const existing = await prisma.tournamentEntry.findUnique({ where: { tournamentId_userId: { tournamentId, userId: req.user.id } } });
    if (existing) {
      return res.status(409).json({ error: 'You are already registered for this tournament' });
    }

    const hasFee = tournament.entryFee > 0;

    const normalizedMethod = String(paymentMethod || '').toUpperCase();
    let entryStatus = 'PENDING_PAYMENT';

    if (normalizedMethod && !NEW_TOURNAMENT_REGISTRATION_PAYMENT_METHODS.includes(normalizedMethod)) {
      return res.status(400).json({ error: 'Tournament registration payment must use Credits or Cash.' });
    }
    if (hasFee && !normalizedMethod) {
      return res.status(400).json({ error: 'Select Credits or Cash for tournament registration.' });
    }

    if (!hasFee) {
      // Free tournament — goes straight to PENDING_APPROVAL
      entryStatus = 'PENDING_APPROVAL';
    }

    let entry;
    if (normalizedMethod === 'CREDITS' && hasFee) {
      entry = await prisma.$transaction(async (tx) => {
        const [wallet, currentActive, duplicate] = await Promise.all([
          tx.membership.findUnique({ where: { userId: req.user.id } }),
          tx.tournamentEntry.count({ where: { tournamentId, status: { in: ACTIVE_ENTRY_STATUSES } } }),
          tx.tournamentEntry.findUnique({ where: { tournamentId_userId: { tournamentId, userId: req.user.id } } }),
        ]);
        if (duplicate) throw Object.assign(new Error('You are already registered for this tournament'), { status: 409 });
        if (currentActive >= tournament.maxPlayers) throw Object.assign(new Error('This tournament is already full'), { status: 400 });
        if (!wallet || Number(wallet.creditBalance) < Number(tournament.entryFee)) throw Object.assign(new Error(`Insufficient credits. You need ${Number(tournament.entryFee).toFixed(0)} credits to register.`), { status: 400, code: 'INSUFFICIENT_CREDITS' });
        const updatedWallet = await tx.membership.update({ where: { userId: req.user.id }, data: { creditBalance: { decrement: tournament.entryFee } } });
        const created = await tx.tournamentEntry.create({ data: { tournamentId, userId: req.user.id, status: 'APPROVED', paymentMethod: 'LOYALTY_CREDIT', paymentRef: `CREDITS-${Date.now()}`, paidAt: new Date(), approvedBy: req.user.id, approvedAt: new Date() }, include: { user: { include: { gamifiedProfile: true } } } });
        await tx.creditTransaction.create({ data: { userId: req.user.id, type: 'TOURNAMENT_FEE', amount: tournament.entryFee, balanceBefore: wallet.creditBalance, balanceAfter: updatedWallet.creditBalance, description: `Tournament registration fee: ${tournament.name}`, paymentMethod: 'LOYALTY_CREDIT', referenceNo: created.paymentRef } });
        return created;
      });
      entryStatus = 'APPROVED';
    } else {
      entry = await prisma.tournamentEntry.create({ data: { tournamentId, userId: req.user.id, status: entryStatus, paymentMethod: normalizedMethod || null, paymentRef: null, paidAt: null }, include: { user: { include: { gamifiedProfile: true } } } });
    }

    // Notify the member that registration is pending
    if (entryStatus === 'APPROVED') {
      await notify(req.user.id, 'TOURNAMENT_APPROVED', 'Tournament Registration Confirmed', `You are registered for ${tournament.name} (${formatLabel(tournament.format)}, Race To ${tournament.raceTo || 5}) on ${localTime(tournament.startDate)}. Registration closes ${localTime(tournament.registrationDeadline)}.`, { tournamentId, entryId: entry.id });
    } else if (entryStatus === 'PENDING_PAYMENT') {
      await notify(
        req.user.id,
        'TOURNAMENT_PAYMENT',
        '📋 Registration Received',
        `You have been registered for "${tournament.name}". Please pay the ₱${tournament.entryFee} entry fee at the counter to complete your registration.`,
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
    res.status(err.status || 500).json({ error: err.message || 'Failed to register for tournament', ...(err.code && { code: err.code }) });
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

    const paidAt = entry.paidAt || (entry.status === 'PENDING_PAYMENT' ? new Date() : undefined);
    const updated = await prisma.tournamentEntry.update({
      where: { id: entryId },
      data: {
        status: 'APPROVED',
        approvedBy: req.user.id,
        approvedAt: new Date(),
        ...(paidAt && { paidAt }),
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

const getCancellationQuote = async (req, res) => {
  try {
    const entry = await prisma.tournamentEntry.findFirst({
      where: { tournamentId: req.params.tournamentId, userId: req.user.id },
      include: { tournament: true },
    });
    if (!entry) return res.status(404).json({ error: 'Tournament registration not found' });
    if (entry.tournament.status === 'IN_PROGRESS' || new Date(entry.tournament.startDate) <= new Date()) {
      return res.status(409).json({ error: 'The tournament has already started. Withdrawal is recorded as a forfeit.', canCancel: false });
    }
    if (entry.status === 'CANCELLED') return res.status(400).json({ error: 'This registration is already cancelled' });
    const fee = await getCancellationFee(entry.tournament);
    res.json({
      canCancel: true,
      entryFeeNonRefundable: true,
      cancellationFee: fee.amount,
      hourlyRate: fee.hourlyRate,
      reservedHours: fee.reservedHours,
      reason: `${fee.reservedHours} hour${fee.reservedHours === 1 ? '' : 's'} of reserved table time for ${entry.tournament.format.replace(/_/g, ' ').toLowerCase()}.`,
    });
  } catch (err) {
    console.error('[Tournament Cancellation Quote Error]', err);
    res.status(500).json({ error: 'Unable to calculate cancellation fee' });
  }
};

const cancelMyEntry = async (req, res) => {
  const { tournamentId } = req.params;
  const { payWithCredits = false, cancelNote } = req.body;

  try {
    const entry = await prisma.tournamentEntry.findFirst({
      where: { tournamentId, userId: req.user.id },
      include: { tournament: true },
    });
    if (!entry) return res.status(404).json({ error: 'Tournament registration not found' });
    if (entry.status === 'CANCELLED') return res.status(400).json({ error: 'This registration is already cancelled' });

    const hasStarted = entry.tournament.status === 'IN_PROGRESS' || new Date(entry.tournament.startDate) <= new Date();
    if (hasStarted) {
      const match = await prisma.tournamentMatch.findFirst({
        where: {
          tournamentId,
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          OR: [{ player1Id: req.user.id }, { player2Id: req.user.id }],
        },
      });
      const opponentId = match?.player1Id === req.user.id ? match.player2Id : match?.player1Id;
      await prisma.$transaction(async (tx) => {
        await tx.tournamentEntry.update({
          where: { id: entry.id },
          data: { status: 'FORFEITED', cancelledAt: new Date(), cancelNote: cancelNote || 'Player withdrew after tournament start.' },
        });
        if (match && opponentId) {
          await tx.tournamentMatch.update({
            where: { id: match.id },
            data: {
              winnerId: opponentId,
              player1Score: match.player1Id === opponentId ? 1 : 0,
              player2Score: match.player2Id === opponentId ? 1 : 0,
              status: 'COMPLETED',
              completedAt: new Date(),
            },
          });
          if (match.nextMatchId) {
            const next = await tx.tournamentMatch.findUnique({ where: { id: match.nextMatchId } });
            if (next && !next.player1Id) await tx.tournamentMatch.update({ where: { id: next.id }, data: { player1Id: opponentId } });
            else if (next && !next.player2Id) await tx.tournamentMatch.update({ where: { id: next.id }, data: { player2Id: opponentId } });
          }
        }
      });
      await notify(req.user.id, 'TOURNAMENT_CANCELLED', 'Tournament Forfeit Recorded', 'The tournament has already started, so your withdrawal was recorded as a forfeit. Registration fees remain non-refundable.', { tournamentId });
      return res.status(409).json({ error: 'The tournament has already started. Your withdrawal was recorded as a forfeit.', recordedAsForfeit: true });
    }

    const fee = await getCancellationFee(entry.tournament);
    let feePaid = false;
    const updated = await prisma.$transaction(async (tx) => {
      const currentEntry = await tx.tournamentEntry.findUnique({ where: { id: entry.id }, select: { status: true } });
      if (!currentEntry || currentEntry.status === 'CANCELLED') throw Object.assign(new Error('This registration is already cancelled'), { status: 409 });
      const membership = await tx.membership.findUnique({ where: { userId: req.user.id } });
      feePaid = fee.amount <= 0 || Number(membership?.creditBalance || 0) >= fee.amount;
      const cancelled = await tx.tournamentEntry.update({
        where: { id: entry.id },
        data: {
          status: 'CANCELLED',
          cancelledBy: req.user.id,
          cancelledAt: new Date(),
          cancelledByPlayer: true,
          cancelNote: cancelNote || null,
          cancellationFee: fee.amount,
          cancellationFeeStatus: feePaid ? 'PAID' : 'PENDING',
          cancellationFeePaidAt: feePaid ? new Date() : null,
        },
      });
      if (feePaid && membership) {
        const updatedMembership = await tx.membership.update({ where: { userId: req.user.id }, data: { creditBalance: { decrement: fee.amount } } });
        await tx.creditTransaction.create({
          data: { userId: req.user.id, type: 'DEDUCTION', amount: fee.amount, balanceBefore: membership.creditBalance, balanceAfter: updatedMembership.creditBalance, description: `Tournament cancellation fee: ${entry.tournament.name}` },
        });
      } else {
        await tx.user.update({ where: { id: req.user.id }, data: { hasPendingCancellationFee: true } });
      }
      return cancelled;
    });

    await notify(req.user.id, 'TOURNAMENT_CANCELLED', 'Tournament Registration Cancelled', `Your registration has been cancelled. The entry fee is non-refundable.${feePaid ? ` The ₱${fee.amount.toFixed(2)} cancellation fee was paid using credits.` : ` A ₱${fee.amount.toFixed(2)} cancellation fee is pending and must be settled before you join another tournament.`}`, { tournamentId, entryId: entry.id, cancellationFee: fee.amount, cancellationFeeStatus: feePaid ? 'PAID' : 'PENDING' });
    req.app.get('io').to(`tournament:${tournamentId}`).emit('tournament:entryCancelled', updated);
    res.json({ message: feePaid ? 'Registration cancelled. Cancellation fee paid.' : 'Registration cancelled. Cancellation fee is pending.', entry: updated, entryFeeRefunded: false, cancellationFee: fee.amount, cancellationFeeStatus: feePaid ? 'PAID' : 'PENDING' });
  } catch (err) {
    console.error('[Player Tournament Cancellation Error]', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to cancel tournament registration' });
  }
};

const settleCancellationFee = async (req, res) => {
  try {
    const entry = await prisma.tournamentEntry.findUnique({ where: { id: req.params.entryId } });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    if (entry.cancellationFeeStatus !== 'PENDING') return res.status(400).json({ error: 'This cancellation fee is not pending' });

    const result = await prisma.$transaction(async (tx) => {
      const settled = await settlePendingCancellationFees(tx, entry.userId, req.user.id);
      if (!settled.paid.some((item) => item.entryId === entry.id)) throw Object.assign(new Error('The member does not yet have enough credits to settle this fee in full.'), { status: 400 });
      await tx.staffAction.create({ data: { staffId: req.user.id, action: 'SETTLE_TOURNAMENT_CANCELLATION_FEE', targetId: entry.userId, details: { entryId: entry.id, amount: entry.cancellationFee } } });
      return settled;
    });
    res.json({ message: 'Cancellation fee settled', balance: result.balance });
  } catch (err) {
    console.error('[Settle Tournament Cancellation Fee Error]', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to settle cancellation fee' });
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

    if (tournament.format === 'SINGLE_ELIMINATION') await prisma.tournamentMatch.deleteMany({ where: { tournamentId } });
    if (tournament.format === 'SINGLE_ELIMINATION') {
      await generateSingleEliminationBracket({ db: prisma, tournamentId, players });
    } else if (tournament.format === 'DOUBLE_ELIMINATION') {
      const result = await generateDoubleEliminationBracket({ db: prisma, tournamentId, players });
      if (!result.generated) {
        const status = result.alreadyGenerated ? 409 : 400;
        const error = result.alreadyGenerated
          ? 'This tournament already has matches. Existing brackets are never regenerated automatically.'
          : 'Double Elimination requires 3 to 8 approved players.';
        return res.status(status).json({ error, reason: result.reason });
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

// ─── Report Match Result ──────────────────────────────────────────────────────

/* Historical pre-transaction result handler retained only as a local reference.
 * The active reportMatchResult below delegates to tournamentMatchResult.service.
const legacyReportMatchResult = async (req, res) => {
  const { matchId } = req.params;
  let { player1Score, player2Score, winnerId } = req.body;

  try {
    const existingMatch = await prisma.tournamentMatch.findUnique({
      where: { id: matchId },
      include: { tournament: { select: { raceTo: true } } },
    });

    if (!existingMatch) return res.status(404).json({ error: 'Match not found' });
    if (existingMatch.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Match already completed' });
    }
    if (!['PENDING', 'IN_PROGRESS'].includes(existingMatch.status) || !existingMatch.player1Id || !existingMatch.player2Id) return res.status(409).json({ error: 'Match is not ready for a result' });
    const score1 = Number(player1Score);
    const score2 = Number(player2Score);
    const raceTo = existingMatch.tournament.raceTo || 5;
    if (!Number.isInteger(score1) || !Number.isInteger(score2) || score1 < 0 || score2 < 0 || score1 === score2 || Math.max(score1, score2) !== raceTo || Math.min(score1, score2) >= raceTo) return res.status(400).json({ error: `Final score must have exactly one player reach Race To ${raceTo}.` });
    const derivedWinnerId = score1 === raceTo ? existingMatch.player1Id : existingMatch.player2Id;
    if (winnerId && winnerId !== derivedWinnerId) return res.status(400).json({ error: 'Winner does not match the submitted score.' });
    winnerId = derivedWinnerId;

    const match = await prisma.tournamentMatch.update({
      where: { id: matchId },
      data: {
        player1Score: score1,
        player2Score: score2,
        winnerId: derivedWinnerId,
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
        // Tournament loss fees are fixed business fees, independent of table
        // type, duration, and Race To. Never overdraw the wallet.
        const loserMembership = await prisma.membership.findUnique({ where: { userId: loserId } });
        if (loserMembership && Number(loserMembership.creditBalance) >= 200) {
          const charged = await prisma.membership.update({ where: { userId: loserId }, data: { creditBalance: { decrement: 200 } } });
          await prisma.creditTransaction.create({ data: { userId: loserId, type: 'DEDUCTION', amount: 200, balanceBefore: loserMembership.creditBalance, balanceAfter: charged.creditBalance, description: `Tournament match loss fee: ${match.tournamentId}` } });
        } else {
          await notify(loserId, 'SYSTEM', 'Tournament loss fee pending', 'Your match result was recorded. Please top up 200 credits for the tournament loss fee.', { matchId: match.id, amount: 200 });
        }
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

        const tournament = await prisma.tournament.findUnique({ where: { id: match.tournamentId }, select: { name: true, format: true, endDate: true } });
        if (tournament) {
          await prisma.championTitle.upsert({
            where: { userId_tournamentId: { userId: winnerId, tournamentId: match.tournamentId } },
            create: { userId: winnerId, tournamentId: match.tournamentId, tournamentName: tournament.name, format: tournament.format, earnedAt: tournament.endDate || new Date() },
            update: {},
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

*/
const reportMatchResult = async (req, res) => {
  const { matchId } = req.params;
  const { player1Score, player2Score, winnerId } = req.body;

  try {
    const result = await completeTournamentMatch({ prisma, matchId, player1Score, player2Score, suppliedWinnerId: winnerId });
    const match = result.match;
    if (result.pendingFeeNotification) {
      await notify(result.pendingFeeNotification.userId, 'SYSTEM', '200-Credit Match-Loss Fee Outstanding', 'Your match result was recorded. You have a 200-credit tournament match-loss fee outstanding; top up to settle it.', { matchId: result.pendingFeeNotification.matchId, amount: 200, feeType: 'TOURNAMENT_MATCH_LOSS' });
    }
    const updatedTournament = await prisma.tournament.findUnique({
      where: { id: match.tournamentId },
      include: {
        matches: { orderBy: [{ round: 'asc' }, { matchNumber: 'asc' }] },
        entries: { include: { user: { include: { gamifiedProfile: true } } } },
      },
    });
    const io = req.app.get('io');
    if (!result.alreadyCompleted) {
      const score = `${match.player1Score}–${match.player2Score}`;
      const winnerNext = updatedTournament.matches.find((item) => item.id !== match.id && (item.player1Id === result.winnerId || item.player2Id === result.winnerId) && ['PENDING', 'IN_PROGRESS'].includes(item.status));
      const winnerMessage = result.tournamentCompleted
        ? `You are the Champion of ${updatedTournament.name}! Final score: ${score}. You earned +150 XP and 120 credits. Cash prize: ₱${Number(updatedTournament.finalPrizePool || 0).toFixed(2)}; payout remains pending Admin confirmation.`
        : `You won your ${updatedTournament.name} match ${score} and advanced.${winnerNext ? ' Check your updated bracket for the next match.' : ''}`;
      await notifyTournamentUsers({ db: prisma, userIds: [result.winnerId], title: result.tournamentCompleted ? 'Tournament Champion' : 'Tournament Match Won', message: winnerMessage, data: { tournamentId: match.tournamentId, matchId: match.id } });

      if (result.resetRequired) {
        await notifyTournamentUsers({ db: prisma, userIds: [match.player1Id, match.player2Id], title: 'Reset Final Required', message: `${updatedTournament.name}: the Losers Bracket champion won the Grand Final (${score}). A Reset Final is required.`, data: { tournamentId: match.tournamentId, matchId: match.id } });
      } else {
        const doubleFirstLoss = updatedTournament.format === 'DOUBLE_ELIMINATION' && match.bracketStage === 'WINNERS' && !!match.nextLoserMatchId;
        await notifyTournamentUsers({ db: prisma, userIds: [result.loserId], title: doubleFirstLoss ? 'Moved to Losers Bracket' : 'Tournament Match Result', message: doubleFirstLoss ? `${updatedTournament.name}: you lost ${score} and moved to the Losers Bracket. You are still in the tournament.` : `${updatedTournament.name}: you lost ${score} and have been eliminated from this tournament.`, data: { tournamentId: match.tournamentId, matchId: match.id } });
      }
      if (result.lossFeeStatus === 'DEDUCTED') await notifyTournamentUsers({ db: prisma, userIds: [result.loserId], title: 'Tournament Match-Loss Fee', message: `A 200-credit tournament match-loss fee was deducted after your played match in ${updatedTournament.name}.`, data: { tournamentId: match.tournamentId, matchId: match.id, amount: 200 } });
      io.to(`tournament:${match.tournamentId}`).emit('match:completed', updatedTournament);
      io.to('tv-display').emit('match:completed', updatedTournament);
      if (result.releasedTableId) {
        io.to('staff-tablet').emit('table:updated', { tableId: result.releasedTableId, status: 'AVAILABLE' });
        io.to('tv-display').emit('table:updated', { tableId: result.releasedTableId, status: 'AVAILABLE' });
      }
    }
    res.json({ match, tournament: updatedTournament, alreadyCompleted: result.alreadyCompleted, bracketResolved: result.bracketResolved, resetRequired: result.resetRequired, winnerId: result.winnerId });
  } catch (err) {
    if (err.code === 'BRACKET_DESTINATION_CONFLICT') {
      console.error('[Tournament Bracket Destination Conflict]', err.routing || err);
      return res.status(409).json({ error: 'Could not advance the tournament bracket. Please refresh and try again.' });
    }
    if (err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[Report Match Result Error]', err);
    res.status(500).json({ error: 'Could not submit the match result. Please try again.' });
  }
};

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
    // ChampionTitle is intentionally a historical record rather than a relation
    // on Tournament.  Attach it to this read model so member/TV clients never
    // have to infer a champion from the last match in the bracket.
    const tableIds = [...new Set(tournament.matches.map((match) => match.tableId).filter(Boolean))];
    const [championTitle, tables, payout] = await Promise.all([
      prisma.championTitle.findFirst({
        where: { tournamentId },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              gamifiedProfile: { select: { displayName: true } },
            },
          },
        },
        orderBy: { earnedAt: 'desc' },
      }),
      tableIds.length
        ? prisma.billiardTable.findMany({ where: { id: { in: tableIds } }, select: { id: true, tableNumber: true, type: true } })
        : [],
      prisma.tournamentPayout.findUnique({
        where: { tournamentId },
        select: { id: true, amount: true, method: true, status: true, paidAt: true },
      }),
    ]);
    const tableById = new Map(tables.map((table) => [table.id, table]));
    const decorated = await decorateTournament(tournament);
    res.json({
      ...decorated,
      championTitle,
      payout,
      matches: decorated.matches.map((match) => ({ ...match, table: match.tableId ? tableById.get(match.tableId) || null : null })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tournament' });
  }
};

// ─── List Tournaments ─────────────────────────────────────────────────────────

const listTournaments = async (req, res) => {
  try {
    const activeOnly = req.user.role === 'MEMBER';
    const tournaments = await prisma.tournament.findMany({
      where: activeOnly ? { OR: [
        { status: 'IN_PROGRESS' },
        // Completed brackets remain a member-facing historical result.
        { status: 'COMPLETED' },
        { status: { in: ['UPCOMING', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'] }, startDate: { gte: new Date() } },
      ] } : undefined,
      // Tournament lists represent when the tournament occurs. Keep the most
      // recent occurrence first and make equal start times deterministic.
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { entries: true } } },
    });
    const tournamentIds = tournaments.map((tournament) => tournament.id);
    if (!tournamentIds.length) return res.json([]);

    // Avoid two count queries per tournament. Supabase's session pool is small
    // and the old Promise.all fan-out could exceed it for a normal tournament
    // list. These two aggregate queries provide the same authoritative counts.
    const [activeCounts, paidCounts] = await Promise.all([
      prisma.tournamentEntry.groupBy({
        by: ['tournamentId'],
        where: { tournamentId: { in: tournamentIds }, status: { in: ACTIVE_ENTRY_STATUSES } },
        _count: { _all: true },
      }),
      prisma.tournamentEntry.groupBy({
        by: ['tournamentId'],
        where: { tournamentId: { in: tournamentIds }, ...paidEntryWhere },
        _count: { _all: true },
      }),
    ]);
    const activeByTournament = new Map(activeCounts.map((row) => [row.tournamentId, row._count._all]));
    const paidByTournament = new Map(paidCounts.map((row) => [row.tournamentId, row._count._all]));
    res.json(await Promise.all(tournaments.map((tournament) => decorateTournament(tournament, {
      activePlayerCount: activeByTournament.get(tournament.id) || 0,
      paidRegistrationCount: paidByTournament.get(tournament.id) || 0,
    }))));
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

const listMyPendingCancellationFees = async (req, res) => {
  try {
    const fees = await prisma.tournamentEntry.findMany({
      where: { userId: req.user.id, cancellationFeeStatus: 'PENDING', cancellationFee: { gt: 0 } },
      include: { tournament: { select: { id: true, name: true } } },
      orderBy: { cancelledAt: 'asc' },
    });
    res.json(fees);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pending cancellation fees' });
  }
};

module.exports = {
  createTournament,
  closeRegistration,
  scheduleMatch,
  assignMatchTable,
  setupMatch,
  startMatch,
  markPrizePaid,
  registerForTournament,
  getCancellationQuote,
  cancelMyEntry,
  settleCancellationFee,
  approveEntry,
  cancelEntry,
  generateBrackets,
  reportMatchResult,
  getTournament,
  listTournaments,
  listPendingEntries,
  listMyPendingCancellationFees,
  decorateTournament,
};
