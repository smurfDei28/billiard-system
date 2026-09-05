const prisma = require('../config/prisma');
const { awardSpendReward } = require('../utils/creditLifecycle');
const { ACTIVE_QUEUE_STATUSES, emitQueueUpdated } = require('./queue.controller');
const { minimumCharge, sessionCharge, elapsedMinutesAt, roundCredits, normalizePersistedCreditBalance } = require('../utils/sessionBilling');

const MIN_WALKIN_DURATION_MS = 30 * 60 * 1000;
const hasMinimumWalkInDuration = (startTime, expectedEndTime) =>
  expectedEndTime.getTime() - startTime.getTime() >= MIN_WALKIN_DURATION_MS;
const resolveWalkInExpectedEnd = (startTime, suppliedEndTime) => {
  const expectedEndTime = new Date(suppliedEndTime);
  if (Number.isNaN(expectedEndTime.getTime())) return expectedEndTime;
  // Older/mobile time pickers can submit the selected clock time on the start
  // date. An equal-or-earlier clock time belongs to the following calendar day.
  if (expectedEndTime <= startTime) expectedEndTime.setDate(expectedEndTime.getDate() + 1);
  return expectedEndTime;
};

// Reservation-created sessions preserve the reservation start time exactly.
// Use that existing scheduler convention as the narrow legacy link until a
// persisted reservationId is available; never infer from user or proximity.
const completeLinkedReservation = async (tx, session) => {
  const reservation = await tx.reservation.findFirst({
    where: { tableId: session.tableId, status: 'APPROVED', startTime: session.startTime },
  });
  if (!reservation) return null;
  return tx.reservation.update({ where: { id: reservation.id }, data: { status: 'COMPLETED' } });
};

// Get all tables with current status
const getAllTables = async (req, res) => {
  try {
    await prisma.$transaction([
      prisma.billiardTable.updateMany({ where: { type: 'STANDARD', ratePerHour: { not: 120 } }, data: { ratePerHour: 120 } }),
      prisma.billiardTable.updateMany({ where: { type: 'VIP', ratePerHour: { not: 200 } }, data: { ratePerHour: 200 } }),
    ]);

    const now = new Date();
    const tables = await prisma.billiardTable.findMany({
      orderBy: { tableNumber: 'asc' },
      include: {
        sessions: {
          where: { status: 'ACTIVE' },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        reservations: {
          where: { status: { in: ['PENDING', 'APPROVED'] }, endTime: { gt: now } },
          orderBy: { startTime: 'asc' },
          select: {
            id: true, startTime: true, endTime: true, status: true,
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });
    // Keep the model unchanged while exposing explicit display fields for the
    // active reservation and the next future reservation on each table.
    res.json(tables.map((table) => {
      const activeSession = table.sessions[0];
      const currentReservation = activeSession && !activeSession.isWalkin
        ? table.reservations.find((reservation) => new Date(reservation.startTime).getTime() === new Date(activeSession.startTime).getTime()) || null
        : null;
      const nextReservation = table.reservations.find((reservation) => new Date(reservation.startTime) > now) || null;
      // The old walk-in queue was retired in favour of reservations. Keep an
      // empty array in the response for older mobile builds that still render
      // table.queue, without exposing stale legacy QueueEntry rows.
      return { ...table, queue: [], currentReservation, nextReservation };
    }));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tables' });
  }
};

// Start a session on a table
const startSession = async (req, res) => {
  const { tableId } = req.params;
  const { userId, isWalkin, walkinName, queueEntryId, expectedEndTime } = req.body;

  try {
    const table = await prisma.billiardTable.findUnique({ where: { id: tableId } });
    if (!table) return res.status(404).json({ error: 'Table not found' });
    const session = await prisma.$transaction(async (tx) => {
      const startedAt = new Date();
      const plannedEnd = isWalkin ? resolveWalkInExpectedEnd(startedAt, expectedEndTime) : null;
      if (isWalkin && Number.isNaN(plannedEnd.getTime())) {
        throw Object.assign(new Error('An expected end time is required for walk-in sessions.'), { status: 400 });
      }
      if (isWalkin && !hasMinimumWalkInDuration(startedAt, plannedEnd)) {
        throw Object.assign(new Error('Walk-in sessions must be at least 30 minutes.'), { status: 400 });
      }
      const activeSession = await tx.tableSession.findFirst({ where: { tableId, status: 'ACTIVE' } });
      if (activeSession) throw Object.assign(new Error('Table is already occupied'), { status: 400 });
      if (isWalkin) {
        const reservationConflict = await tx.reservation.findFirst({
          where: {
            tableId,
            status: { in: ['PENDING', 'APPROVED'] },
            startTime: { lt: plannedEnd },
            endTime: { gt: startedAt },
          },
          orderBy: { startTime: 'asc' },
        });
        if (reservationConflict) {
          throw Object.assign(new Error(`This table has a reservation starting at ${new Date(reservationConflict.startTime).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}. Select an earlier end time.`), { status: 409, code: 'RESERVATION_CONFLICT' });
        }
      }
      const queuedEntry = queueEntryId
        ? await tx.queueEntry.findFirst({ where: { id: queueEntryId, tableId, status: { in: ACTIVE_QUEUE_STATUSES } }, orderBy: { joinedAt: 'asc' } })
        : userId
          ? await tx.queueEntry.findFirst({ where: { tableId, userId, status: { in: ACTIVE_QUEUE_STATUSES } }, orderBy: { joinedAt: 'asc' } })
          : null;
      if (queuedEntry) {
        const firstEntry = await tx.queueEntry.findFirst({ where: { tableId, status: { in: ACTIVE_QUEUE_STATUSES } }, orderBy: { joinedAt: 'asc' } });
        if (firstEntry?.id !== queuedEntry.id || queuedEntry.status !== 'CALLED') throw Object.assign(new Error('Only the member currently called from the queue can start this table'), { status: 409 });
        const reservation = await tx.reservation.findFirst({ where: { tableId, status: 'APPROVED', endTime: { gt: new Date() } }, orderBy: { startTime: 'asc' } });
        if (reservation) throw Object.assign(new Error(`Cannot start this queued session: Table ${table.tableNumber} has an approved reservation at ${new Date(reservation.startTime).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}.`), { status: 409, code: 'RESERVATION_CONFLICT' });
      }
      const billedUserId = userId || queuedEntry?.userId || null;
      const minimum = minimumCharge(table.ratePerHour);
      let membership = null;
      if (billedUserId) {
        membership = await tx.membership.findUnique({ where: { userId: billedUserId } });
        if (!membership || membership.status !== 'ACTIVE' || Number(membership.creditBalance) < minimum) {
          throw Object.assign(new Error(`Insufficient credits to start. Table ${table.tableNumber} requires ${minimum.toFixed(2)} credits for the 30-minute minimum.`), { status: 400, code: 'INSUFFICIENT_CREDITS', minimumCharge: minimum });
        }
      }
      const claim = await tx.billiardTable.updateMany({ where: { id: tableId, status: { in: ['AVAILABLE', 'RESERVED'] } }, data: { status: 'OCCUPIED' } });
      if (claim.count !== 1) throw Object.assign(new Error('Table is not available'), { status: 400 });
      const s = await tx.tableSession.create({
        data: {
          tableId,
          userId: billedUserId,
          isWalkin: isWalkin || false,
          startTime: startedAt,
          expectedEndTime: plannedEnd,
          creditsUsed: billedUserId ? minimum : 0,
          status: 'ACTIVE',
        },
      });
      if (membership && billedUserId) {
        const updatedMembership = await tx.membership.update({ where: { userId: billedUserId }, data: { creditBalance: { decrement: minimum } } });
        const balanceAfter = await normalizePersistedCreditBalance(tx, billedUserId, updatedMembership.creditBalance);
        await tx.creditTransaction.create({ data: {
          userId: billedUserId, type: 'DEDUCTION', amount: minimum,
          balanceBefore: membership.creditBalance, balanceAfter,
          description: `Table ${table.tableNumber} 30-minute minimum session charge`,
        } });
      }
      if (queuedEntry) await tx.queueEntry.update({ where: { id: queuedEntry.id }, data: { status: 'SEATED' } });
      return s;
    });

    const io = req.app.get('io');
    io.emit('table:updated', { tableId, status: 'OCCUPIED', session });
    emitQueueUpdated(io, tableId);

    res.status(201).json(session);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Failed to start session', code: err.code });
  }
};

// End a session
const endSession = async (req, res) => {
  const { sessionId } = req.params;

  try {
    const session = await prisma.tableSession.findUnique({ where: { id: sessionId } });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'ACTIVE') return res.status(409).json({ error: 'Session is already ended' });

    const duration = elapsedMinutesAt(session.startTime);
    const table = await prisma.billiardTable.findUnique({ where: { id: session.tableId } });
    const totalUsage = sessionCharge(table.ratePerHour, duration);

    const updated = await prisma.$transaction(async (tx) => {
      let additionalCharge = 0;
      const endedAt = new Date();
      const transition = await tx.tableSession.updateMany({
        where: { id: sessionId, status: 'ACTIVE' },
        data: { status: 'ENDED', endTime: endedAt },
      });
      if (transition.count !== 1) throw Object.assign(new Error('Session is already ended'), { status: 409 });
      const s = { ...session, status: 'ENDED', endTime: endedAt };
      await tx.billiardTable.update({
        where: { id: session.tableId },
        data: { status: 'AVAILABLE' },
      });
      const completedReservation = await completeLinkedReservation(tx, session);

      // Deduct credits if member
      if (session.userId) {
        const membership = await tx.membership.findUnique({ where: { userId: session.userId } });
        if (membership) {
          additionalCharge = roundCredits(Math.max(0, totalUsage - (session.creditsUsed || 0)));
          additionalCharge = Math.min(additionalCharge, membership.creditBalance);

          const updatedMembership = await tx.membership.update({
            where: { userId: session.userId },
            data: {
              creditBalance: { decrement: additionalCharge },
              totalHoursPlayed: { increment: duration / 60 },
            },
          });
          const balanceAfter = await normalizePersistedCreditBalance(tx, session.userId, updatedMembership.creditBalance);
          if (additionalCharge > 0) {
            await tx.tableSession.update({
              where: { id: sessionId },
              data: { creditsUsed: { increment: additionalCharge } },
            });
            await tx.creditTransaction.create({
              data: {
                userId: session.userId,
                type: 'DEDUCTION',
                amount: additionalCharge,
                balanceBefore: membership.creditBalance,
                balanceAfter,
                description: `Table ${table.tableNumber} session - ${Math.round(duration)} minutes`,
              },
            });
          }
        }
      }
      return { ...s, creditsUsed: (session.creditsUsed || 0) + additionalCharge, completedReservation };
    });

    // Rewards and milestone checks can be slow; run them after commit so the session-end
    // transaction stays fast and can't time out.
    if (session.userId) {
      awardSpendReward(session.userId, prisma).catch((err) =>
        console.error('[awardSpendReward][EndSession]', err?.message || err)
      );
      checkLoyaltyMilestone(session.userId, prisma).catch((err) =>
        console.error('[checkLoyaltyMilestone][EndSession]', err?.message || err)
      );
    }

    const io = req.app.get('io');
    io.emit('table:updated', { tableId: session.tableId, status: 'AVAILABLE' });

    // Future table order is reservation-based; legacy QueueEntry records are
    // retained for history and are no longer auto-called when a session ends.
    emitQueueUpdated(req.app.get('io'), session.tableId);

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to end session' });
  }
};

const LOYALTY_MILESTONE_CREDITS = 120;

// Check if loyalty milestone reached (20 hours = one Regular-table hour).
const checkLoyaltyMilestone = async (userId, db) => {
  const membership = await db.membership.findUnique({ where: { userId } });
  if (!membership) return;

  const hoursThreshold = parseInt(process.env.HOURS_FOR_FREE_HOUR) || 20;
  const reachedMilestones = Math.floor(Number(membership.totalHoursPlayed || 0) / hoursThreshold);
  if (reachedMilestones < 1) return;

  // Historical rewards remain untouched. Counting the existing milestone
  // records makes this transition idempotent for refreshes/retries and lets
  // the next legitimately unawarded milestone use the current 120-credit rule.
  const awardedMilestones = await db.loyaltyHistory.count({
    where: { userId, trigger: 'HOURS_MILESTONE' },
  });
  if (awardedMilestones >= reachedMilestones) return;

  {
    const freeCredits = LOYALTY_MILESTONE_CREDITS;
    await db.membership.update({
      where: { userId },
      data: {
        creditBalance: { increment: freeCredits },
      },
    });
    await db.loyaltyHistory.create({
      data: {
        userId,
        trigger: 'HOURS_MILESTONE',
        creditsAwarded: freeCredits,
        description: `🎉 ${reachedMilestones * hoursThreshold} hours played! Earned ${freeCredits} credits — equivalent to one Regular-table hour.`,
      },
    });
    await db.notification.create({
      data: {
        userId,
        type: 'LOYALTY_EARNED',
        title: `${hoursThreshold}-Hour Playing Milestone Reached!`,
        message: `You received ${freeCredits} free Credits for completing a ${hoursThreshold}-hour playing milestone. Keep playing to reach your next milestone!`,
      },
    });
  }
};

// Extend session
const extendSession = async (req, res) => {
  const { sessionId } = req.params;
  const { minutes } = req.body;

  try {
    const session = await prisma.tableSession.findUnique({ where: { id: sessionId } });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Check if anyone is waiting
    const queueCount = await prisma.queueEntry.count({
      where: { tableId: session.tableId, status: 'WAITING' },
    });

    if (queueCount > 0) {
      return res.status(400).json({
        error: 'Cannot extend — players are waiting in queue',
        canExtend: false,
      });
    }

    const creditsNeeded = (minutes / 60) * 60; // rate per hour
    if (session.userId) {
      const membership = await prisma.membership.findUnique({ where: { userId: session.userId } });
      if (!membership || membership.creditBalance < creditsNeeded) {
        return res.status(400).json({ error: 'Insufficient credits to extend', canExtend: false });
      }
    }

    const updated = await prisma.tableSession.update({
      where: { id: sessionId },
      data: { extendCount: { increment: 1 }, status: 'EXTENDED' },
    });

    res.json({ ...updated, canExtend: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to extend session' });
  }
};

// Update table status (maintenance, etc.)
const updateTableStatus = async (req, res) => {
  const { tableId } = req.params;
  const { status } = req.body;

  try {
    const table = await prisma.billiardTable.update({
      where: { id: tableId },
      data: { status },
    });
    const io = req.app.get('io');
    io.emit('table:updated', table);
    emitQueueUpdated(io, tableId);
    res.json(table);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update table' });
  }
};

module.exports = { getAllTables, startSession, endSession, extendSession, updateTableStatus, checkLoyaltyMilestone, LOYALTY_MILESTONE_CREDITS, MIN_WALKIN_DURATION_MS, hasMinimumWalkInDuration, resolveWalkInExpectedEnd, completeLinkedReservation };
