
const prisma = require('../config/prisma');
const { parseReservationPaymentMethod } = require('../utils/reservationMeta');
const { awardSpendReward } = require('../utils/creditLifecycle');
const { emitQueueUpdated } = require('../controllers/queue.controller');

const syncScheduledReservations = async (io) => {
  const now = new Date();
  const reminderWindowStart = new Date(now.getTime() + 30 * 60 * 1000);
  const reminderWindowEnd = new Date(now.getTime() + 60 * 60 * 1000);
  const upcomingReservations = await prisma.reservation.findMany({
    where: { status: 'APPROVED', reminderSentAt: null, startTime: { gte: reminderWindowStart, lte: reminderWindowEnd } },
    include: { table: true },
  });
  for (const reservation of upcomingReservations) {
    await prisma.$transaction([
      prisma.notification.create({ data: {
        userId: reservation.userId, type: 'RESERVATION_REMINDER', title: 'Upcoming reservation reminder',
        message: `Your Table ${reservation.table.tableNumber} reservation starts at ${new Date(reservation.startTime).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}. Please arrive a few minutes early.`,
        data: { reservationId: reservation.id, tableId: reservation.tableId }, actionRoute: 'Reservations',
      } }),
      prisma.reservation.update({ where: { id: reservation.id }, data: { reminderSentAt: now } }),
    ]);
  }

  const reservationsToStart = await prisma.reservation.findMany({
    where: {
      status: 'APPROVED',
      startTime: { lte: now },
      endTime: { gt: now },
    },
    include: { table: true, user: true },
  });

  for (const reservation of reservationsToStart) {
    const activeSession = await prisma.tableSession.findFirst({
      where: {
        tableId: reservation.tableId,
        status: 'ACTIVE',
        startTime: { lte: reservation.endTime },
      },
    });

    if (!activeSession) {
      const paymentMethod = parseReservationPaymentMethod(reservation.notes);
      const session = await prisma.$transaction(async (tx) => {
        const createdSession = await tx.tableSession.create({
          data: {
            tableId: reservation.tableId,
            userId: paymentMethod === 'CASH' ? null : reservation.userId,
            isWalkin: false,
            startTime: reservation.startTime,
            status: 'ACTIVE',
          },
        });

        await tx.billiardTable.update({
          where: { id: reservation.tableId },
          data: { status: 'OCCUPIED' },
        });

        return createdSession;
      });

      io?.emit('table:updated', { tableId: reservation.tableId, status: 'OCCUPIED', session });
      emitQueueUpdated(io, reservation.tableId);
    }
  }

  const reservationsToEnd = await prisma.reservation.findMany({
    where: {
      status: 'APPROVED',
      endTime: { lte: now },
    },
    include: { table: true, user: true },
  });

  for (const reservation of reservationsToEnd) {
    const session = await prisma.tableSession.findFirst({
      where: {
        tableId: reservation.tableId,
        status: 'ACTIVE',
        startTime: reservation.startTime,
      },
    });

    if (!session) {
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { status: 'COMPLETED' },
      });
      continue;
    }

    const paymentMethod = parseReservationPaymentMethod(reservation.notes);
    const reservedMinutes = Math.max(0, Math.round((new Date(reservation.endTime).getTime() - new Date(reservation.startTime).getTime()) / 60000));
    const creditsUsed = (reservedMinutes / 60) * reservation.table.ratePerHour;

    await prisma.$transaction(async (tx) => {
      await tx.tableSession.update({
        where: { id: session.id },
        data: {
          status: 'ENDED',
          endTime: reservation.endTime,
          creditsUsed,
        },
      });

      await tx.billiardTable.update({
        where: { id: reservation.tableId },
        data: { status: 'AVAILABLE' },
      });

      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: 'COMPLETED' },
      });

      if (paymentMethod !== 'CASH' && reservation.userId) {
        const membership = await tx.membership.findUnique({ where: { userId: reservation.userId } });
        if (membership) {
          await tx.membership.update({
            where: { userId: reservation.userId },
            data: {
              creditBalance: { decrement: creditsUsed },
              totalHoursPlayed: { increment: reservedMinutes / 60 },
            },
          });
          await tx.creditTransaction.create({
            data: {
              userId: reservation.userId,
              type: 'DEDUCTION',
              amount: creditsUsed,
              balanceBefore: membership.creditBalance,
              balanceAfter: membership.creditBalance - creditsUsed,
              description: `Reserved Table ${reservation.table.tableNumber} session - ${reservedMinutes} minutes`,
            },
          });
        }
      }
    });

    if (paymentMethod !== 'CASH' && reservation.userId) {
      awardSpendReward(reservation.userId, prisma).catch((err) =>
        console.error('[awardSpendReward][ReservationScheduler]', err?.message || err)
      );
    }

    io?.emit('table:updated', { tableId: reservation.tableId, status: 'AVAILABLE' });
    emitQueueUpdated(io, reservation.tableId);
  }
};

const startReservationScheduler = (io) => {
  syncScheduledReservations(io).catch((err) => console.error('[Reservation Scheduler Init Error]', err));
  return setInterval(() => {
    syncScheduledReservations(io).catch((err) => console.error('[Reservation Scheduler Error]', err));
  }, 60 * 1000);
};

const stopReservationScheduler = (interval) => clearInterval(interval);

module.exports = { startReservationScheduler, stopReservationScheduler, syncScheduledReservations };
