const prisma = require('../config/prisma');
const { callFirstWaitingForAvailableTable, emitQueueUpdated } = require('../controllers/queue.controller');
const { sessionCharge, elapsedMinutesAt, roundCredits, normalizePersistedCreditBalance } = require('../utils/sessionBilling');

const syncActiveSessions = async (io) => {
  const sessions = await prisma.tableSession.findMany({
    where: { status: 'ACTIVE', userId: { not: null } },
    include: { table: true },
  });

  for (const session of sessions) {
    const membership = await prisma.membership.findUnique({ where: { userId: session.userId } });
    if (!membership) continue;

    const elapsedMinutes = elapsedMinutesAt(session.startTime);
    const shouldBeUsed = sessionCharge(session.table.ratePerHour, elapsedMinutes);
    const alreadyUsed = Number(session.creditsUsed || 0);
    const additionalNeeded = roundCredits(shouldBeUsed - alreadyUsed);

    if (additionalNeeded <= 0) continue;

    const available = Number(membership.creditBalance || 0);
    const deduction = Math.min(additionalNeeded, available);

    await prisma.$transaction(async (tx) => {
      if (deduction > 0) {
        const updatedMembership = await tx.membership.update({
          where: { userId: session.userId },
          data: { creditBalance: { decrement: deduction } },
        });
        const balanceAfter = await normalizePersistedCreditBalance(tx, session.userId, updatedMembership.creditBalance);

        await tx.tableSession.update({
          where: { id: session.id },
          data: { creditsUsed: { increment: deduction } },
        });

        await tx.creditTransaction.create({
          data: {
            userId: session.userId,
            type: 'DEDUCTION',
            amount: deduction,
            balanceBefore: membership.creditBalance,
            balanceAfter,
            description: `Auto-deduction for Table ${session.table.tableNumber} usage`,
          },
        });
      }

      if (available <= additionalNeeded) {
        await tx.tableSession.update({
          where: { id: session.id },
          data: {
            status: 'ENDED',
            endTime: new Date(),
          },
        });

        await tx.billiardTable.update({
          where: { id: session.tableId },
          data: { status: 'AVAILABLE' },
        });

        await tx.notification.create({
          data: {
            userId: session.userId,
            type: 'TIME_ENDING',
            title: 'Table Session Ended',
            message: `Your session on Table ${session.table.tableNumber} ended because your available credits were fully used.`,
          },
        });
      }
    });

    if (available <= additionalNeeded) {
      io?.emit('table:updated', { tableId: session.tableId, status: 'AVAILABLE' });
      await callFirstWaitingForAvailableTable(session.tableId, io);
      emitQueueUpdated(io, session.tableId);
    }
  }
};

const startSessionMonitor = (io) => {
  syncActiveSessions(io).catch((err) => console.error('[Session Monitor Init Error]', err));
  return setInterval(() => {
    syncActiveSessions(io).catch((err) => console.error('[Session Monitor Error]', err));
  }, 60 * 1000);
};

const stopSessionMonitor = (interval) => clearInterval(interval);

module.exports = { startSessionMonitor, stopSessionMonitor, syncActiveSessions };
