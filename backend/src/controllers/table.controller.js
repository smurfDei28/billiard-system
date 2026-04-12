const prisma = require('../config/prisma');

// Get all tables with current status
const getAllTables = async (req, res) => {
  try {
    const tables = await prisma.billiardTable.findMany({
      orderBy: { tableNumber: 'asc' },
      include: {
        sessions: {
          where: { status: 'ACTIVE' },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        queue: {
          where: { status: 'WAITING' },
          orderBy: { position: 'asc' },
        },
      },
    });
    res.json(tables);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tables' });
  }
};

// Start a session on a table
const startSession = async (req, res) => {
  const { tableId } = req.params;
  const { userId, isWalkin, walkinName } = req.body;

  try {
    const table = await prisma.billiardTable.findUnique({ where: { id: tableId } });
    if (!table) return res.status(404).json({ error: 'Table not found' });
    if (table.status === 'OCCUPIED') return res.status(400).json({ error: 'Table is already occupied' });

    const session = await prisma.$transaction(async (tx) => {
      const s = await tx.tableSession.create({
        data: {
          tableId,
          userId: userId || null,
          isWalkin: isWalkin || false,
          status: 'ACTIVE',
        },
      });
      await tx.billiardTable.update({
        where: { id: tableId },
        data: { status: 'OCCUPIED' },
      });
      return s;
    });

    const io = req.app.get('io');
    io.to('tv-display').emit('table:updated', { tableId, status: 'OCCUPIED' });
    io.to('staff-tablet').emit('table:updated', { tableId, status: 'OCCUPIED', session });

    res.status(201).json(session);
  } catch (err) {
    res.status(500).json({ error: 'Failed to start session' });
  }
};

// End a session
const endSession = async (req, res) => {
  const { sessionId } = req.params;

  try {
    const session = await prisma.tableSession.findUnique({ where: { id: sessionId } });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const duration = (Date.now() - new Date(session.startTime).getTime()) / 1000 / 60; // minutes
    const table = await prisma.billiardTable.findUnique({ where: { id: session.tableId } });
    const creditsUsed = (duration / 60) * table.ratePerHour;

    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.tableSession.update({
        where: { id: sessionId },
        data: { status: 'ENDED', endTime: new Date(), creditsUsed },
      });
      await tx.billiardTable.update({
        where: { id: session.tableId },
        data: { status: 'AVAILABLE' },
      });

      // Deduct credits if member
      if (session.userId) {
        const membership = await tx.membership.findUnique({ where: { userId: session.userId } });
        if (membership) {
          await tx.membership.update({
            where: { userId: session.userId },
            data: {
              creditBalance: { decrement: creditsUsed },
              totalHoursPlayed: { increment: duration / 60 },
            },
          });
          await tx.creditTransaction.create({
            data: {
              userId: session.userId,
              type: 'DEDUCTION',
              amount: creditsUsed,
              balanceBefore: membership.creditBalance,
              balanceAfter: membership.creditBalance - creditsUsed,
              description: `Table ${table.tableNumber} session - ${Math.round(duration)} minutes`,
            },
          });
          // Check loyalty milestone
          await checkLoyaltyMilestone(session.userId, tx);
        }
      }
      return s;
    });

    const io = req.app.get('io');
    io.to('tv-display').emit('table:updated', { tableId: session.tableId, status: 'AVAILABLE' });
    io.to('staff-tablet').emit('table:updated', { tableId: session.tableId, status: 'AVAILABLE' });

    // Notify next in queue
    await notifyNextInQueue(session.tableId, req.app.get('io'));

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to end session' });
  }
};

// Check if loyalty milestone reached (20 hours = 1 free hour)
const checkLoyaltyMilestone = async (userId, tx) => {
  const membership = await tx.membership.findUnique({ where: { userId } });
  if (!membership) return;

  const hoursThreshold = parseInt(process.env.HOURS_FOR_FREE_HOUR) || 20;
  const previousMilestone = Math.floor((membership.totalHoursPlayed - (membership.totalHoursPlayed % hoursThreshold)) / hoursThreshold);
  const newMilestone = Math.floor(membership.totalHoursPlayed / hoursThreshold);

  if (newMilestone > previousMilestone) {
    const freeCredits = 60; // 1 hour
    await tx.membership.update({
      where: { userId },
      data: { creditBalance: { increment: freeCredits } },
    });
    await tx.loyaltyHistory.create({
      data: {
        userId,
        trigger: 'HOURS_MILESTONE',
        creditsAwarded: freeCredits,
        description: `🎉 ${newMilestone * hoursThreshold} hours played! Earned 1 free hour.`,
      },
    });
    await tx.notification.create({
      data: {
        userId,
        type: 'LOYALTY_EARNED',
        title: '🎉 Loyalty Reward!',
        message: `You've played ${newMilestone * hoursThreshold} hours! Enjoy 1 free hour of play.`,
      },
    });
  }
};

// Notify next person in queue
const notifyNextInQueue = async (tableId, io) => {
  const next = await prisma.queueEntry.findFirst({
    where: { tableId, status: 'WAITING' },
    orderBy: { position: 'asc' },
    include: { user: true },
  });

  if (next) {
    await prisma.queueEntry.update({
      where: { id: next.id },
      data: { status: 'CALLED', notifiedAt: new Date() },
    });

    if (next.userId) {
      await prisma.notification.create({
        data: {
          userId: next.userId,
          type: 'QUEUE_UPDATE',
          title: '🎱 Your table is ready!',
          message: `Table is now available. Please proceed to your table.`,
          data: { tableId },
        },
      });
    }

    io.to('tv-display').emit('queue:called', { tableId, entry: next });
    io.to('staff-tablet').emit('queue:called', { tableId, entry: next });
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
    io.to('tv-display').emit('table:updated', table);
    io.to('staff-tablet').emit('table:updated', table);
    res.json(table);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update table' });
  }
};

module.exports = { getAllTables, startSession, endSession, extendSession, updateTableStatus };
