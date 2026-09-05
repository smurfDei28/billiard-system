const prisma = require('../config/prisma');
const {
  encodeReservationNotes,
  parseReservationPaymentMethod,
  mapReservationResponse,
} = require('../utils/reservationMeta');

const MIN_RESERVATION_DURATION_MS = 30 * 60 * 1000;
const hasMinimumReservationDuration = (start, end) => end.getTime() - start.getTime() >= MIN_RESERVATION_DURATION_MS;
const isOnlineReservationPaymentMethod = (paymentMethod) => !paymentMethod || paymentMethod === 'CREDITS';
const reservationIntervalsOverlap = (requestedStart, requestedEnd, existingStart, existingEnd) =>
  requestedStart < existingEnd && requestedEnd > existingStart;

// ─── Helper ───────────────────────────────────────────────────────────────────

const notify = async (userId, type, title, message, data = {}) => {
  try {
    let enhancedMessage = message;
    if (data.reservationId && ['RESERVATION_SUBMITTED', 'RESERVATION_APPROVED'].includes(type)) {
      const reservation = await prisma.reservation.findUnique({ where: { id: data.reservationId }, include: { table: true } });
      if (reservation) {
        const duration = Math.round((new Date(reservation.endTime) - new Date(reservation.startTime)) / 60000);
        enhancedMessage += ` Duration: ${duration} minutes. Reference: ${reservation.id.slice(0, 8).toUpperCase()}.`;
      }
    }
    await prisma.notification.create({ data: { userId, type, title, message: enhancedMessage, data, actionRoute: 'Reservations' } });
  } catch (err) {
    console.error('[Notify Error]', err.message);
  }
};

// ─── Member: Request a Reservation ───────────────────────────────────────────

const requestReservation = async (req, res) => {
  const { tableId, startTime, endTime, notes, paymentMethod } = req.body;

  if (!tableId || !startTime || !endTime) {
    return res.status(400).json({ error: 'tableId, startTime, and endTime are required' });
  }

  if (!isOnlineReservationPaymentMethod(paymentMethod)) {
    return res.status(400).json({ error: 'Cash payment is not available for online reservations. Please use Credits.' });
  }

  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return res.status(400).json({ error: 'Reservation start and end times must be valid.' });
  }

  // Validate dates are in the future
  if (start <= new Date()) {
    return res.status(400).json({ error: 'Reservation start time must be in the future' });
  }

  if (end <= start) {
    return res.status(400).json({ error: 'End time must be after start time' });
  }

  if (!hasMinimumReservationDuration(start, end)) {
    return res.status(400).json({ error: 'Reservation duration must be at least 30 minutes.' });
  }

  try {
    const table = await prisma.billiardTable.findUnique({ where: { id: tableId } });
    if (!table) return res.status(404).json({ error: 'Table not found' });
    if (table.status === 'MAINTENANCE') {
      return res.status(400).json({ error: 'This table is currently under maintenance' });
    }

    const selectedPaymentMethod = 'CREDITS';
    const membership = await prisma.membership.findUnique({ where: { userId: req.user.id } });
    const reservedMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
    const estimatedCost = (reservedMinutes / 60) * table.ratePerHour;

    if (!membership || membership.creditBalance < estimatedCost) {
      return res.status(400).json({
        error: `Insufficient credits. You need at least ${estimatedCost.toFixed(0)} credits for this reservation.`,
        estimatedCost: Number(estimatedCost.toFixed(2)),
        creditBalance: membership?.creditBalance ?? 0,
      });
    }

    // Check for overlapping APPROVED or PENDING reservations
    const conflict = await prisma.reservation.findFirst({
      where: {
        tableId,
        status: { in: ['PENDING', 'APPROVED'] },
        OR: [
          { startTime: { lt: end }, endTime: { gt: start } },
        ],
      },
    });

    if (conflict) {
      return res.status(409).json({
        error: 'This table is already reserved or pending for that time slot. Please choose a different time.',
      });
    }

    const reservation = await prisma.reservation.create({
      data: {
        tableId,
        userId: req.user.id,
        startTime: start,
        endTime: end,
        status: 'PENDING',
        notes: encodeReservationNotes(notes, selectedPaymentMethod),
      },
      include: {
        table: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      },
    });

    // Notify the member
    await notify(
      req.user.id,
      'RESERVATION_SUBMITTED',
      '📋 Reservation Request Received',
      `Your request to reserve Table ${table.tableNumber} on ${start.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} is pending staff approval.`,
      { reservationId: reservation.id, tableId }
    );

    // Notify all staff and admins
    const staffAndAdmins = await prisma.user.findMany({
      where: { role: { in: ['STAFF', 'ADMIN'] } },
    });
    await prisma.notification.createMany({
      data: staffAndAdmins.map((s) => ({
        userId: s.id,
        type: 'RESERVATION_SUBMITTED',
        title: '📋 New Reservation Request',
        message: `${reservation.user.firstName} ${reservation.user.lastName} requested Table ${table.tableNumber} on ${start.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}.`,
        data: { reservationId: reservation.id }, actionRoute: 'Reservations',
      })),
    });

    const io = req.app.get('io');
    io.to('staff-tablet').emit('reservation:new', reservation);
    io.emit('queue:updated', { tableId });

    res.status(201).json(mapReservationResponse(reservation));
  } catch (err) {
    console.error('[Request Reservation Error]', err);
    res.status(500).json({ error: 'Failed to submit reservation request' });
  }
};

// ─── Staff/Admin: Approve Reservation ────────────────────────────────────────

const approveReservation = async (req, res) => {
  const { reservationId } = req.params;

  try {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { table: true, user: true },
    });

    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    if (reservation.status !== 'PENDING') {
      return res.status(400).json({ error: `Reservation is already ${reservation.status.toLowerCase()}` });
    }

    const selectedPaymentMethod = parseReservationPaymentMethod(reservation.notes);
    if (selectedPaymentMethod !== 'CASH') {
      const membership = await prisma.membership.findUnique({ where: { userId: reservation.userId } });
      const reservedMinutes = Math.max(0, Math.round((new Date(reservation.endTime).getTime() - new Date(reservation.startTime).getTime()) / 60000));
      const estimatedCost = (reservedMinutes / 60) * reservation.table.ratePerHour;

      if (!membership || membership.creditBalance < estimatedCost) {
        return res.status(400).json({
          error: `Cannot approve reservation. Member needs at least ${estimatedCost.toFixed(0)} credits.`,
        });
      }
    }

    const updated = await prisma.reservation.update({
      where: { id: reservationId },
      data: {
        status: 'APPROVED',
        reviewedBy: req.user.id,
        reviewedAt: new Date(),
      },
    });

    // Notify member
    await notify(
      reservation.userId,
      'RESERVATION_APPROVED',
      '✅ Reservation Approved',
      `Your reservation for Table ${reservation.table.tableNumber} on ${new Date(reservation.startTime).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} has been approved!`,
      { reservationId }
    );

    await prisma.staffAction.create({
      data: {
        staffId: req.user.id,
        action: 'APPROVE_RESERVATION',
        targetId: reservation.userId,
        details: { reservationId, tableId: reservation.tableId },
      },
    });

    const io = req.app.get('io');
    io.to('staff-tablet').emit('reservation:updated', updated);
    io.emit('queue:updated', { tableId: reservation.tableId });

    res.json({ message: 'Reservation approved', reservation: mapReservationResponse(updated) });
  } catch (err) {
    console.error('[Approve Reservation Error]', err);
    res.status(500).json({ error: 'Failed to approve reservation' });
  }
};

// ─── Staff/Admin: Decline Reservation ────────────────────────────────────────

const declineReservation = async (req, res) => {
  const { reservationId } = req.params;
  const { declineNote } = req.body;

  try {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { table: true, user: true },
    });

    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    if (reservation.status !== 'PENDING') {
      return res.status(400).json({ error: `Reservation is already ${reservation.status.toLowerCase()}` });
    }

    const updated = await prisma.reservation.update({
      where: { id: reservationId },
      data: {
        status: 'DECLINED',
        reviewedBy: req.user.id,
        reviewedAt: new Date(),
        declineNote: declineNote || null,
      },
    });

    // Notify member
    await notify(
      reservation.userId,
      'RESERVATION_DECLINED',
      '❌ Reservation Declined',
      `Your reservation request for Table ${reservation.table.tableNumber} on ${new Date(reservation.startTime).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} was declined.${declineNote ? ` Reason: ${declineNote}` : ''}`,
      { reservationId }
    );

    await prisma.staffAction.create({
      data: {
        staffId: req.user.id,
        action: 'DECLINE_RESERVATION',
        targetId: reservation.userId,
        details: { reservationId, declineNote },
      },
    });

    const io = req.app.get('io');
    io.to('staff-tablet').emit('reservation:updated', updated);
    io.emit('queue:updated', { tableId: reservation.tableId });

    res.json({ message: 'Reservation declined', reservation: mapReservationResponse(updated) });
  } catch (err) {
    console.error('[Decline Reservation Error]', err);
    res.status(500).json({ error: 'Failed to decline reservation' });
  }
};

// ─── Get My Reservations (Member) ────────────────────────────────────────────

const cancelMyReservation = async (req, res) => {
  const { reservationId } = req.params;
  try {
    const reservation = await prisma.reservation.findFirst({ where: { id: reservationId, userId: req.user.id }, include: { table: true } });
    if (!reservation) return res.status(404).json({ error: 'Reservation not found.' });
    if (!['PENDING', 'APPROVED'].includes(reservation.status)) return res.status(409).json({ error: `This reservation cannot be cancelled because it is ${reservation.status.toLowerCase()}.` });
    if (new Date(reservation.startTime) <= new Date()) return res.status(409).json({ error: 'Reservations cannot be cancelled once the booked time has started.' });
    const updated = await prisma.reservation.update({ where: { id: reservationId }, data: { status: 'CANCELLED' } });
    await notify(req.user.id, 'RESERVATION_CANCELLED', 'Reservation cancelled', `Your Table ${reservation.table.tableNumber} reservation has been cancelled. No cancellation fee applies under the current reservation rules.`, { reservationId, tableId: reservation.tableId });
    const io = req.app.get('io');
    io.to('staff-tablet').emit('reservation:updated', updated);
    io.emit('queue:updated', { tableId: reservation.tableId });
    res.json({ message: 'Reservation cancelled. No cancellation fee applies.', reservation: mapReservationResponse(updated) });
  } catch (err) {
    console.error('[Cancel Reservation Error]', err);
    res.status(500).json({ error: 'Could not cancel this reservation.' });
  }
};

const getMyReservations = async (req, res) => {
  try {
    const reservations = await prisma.reservation.findMany({
      where: { userId: req.user.id },
      include: { table: true },
      orderBy: { startTime: 'desc' },
    });
    res.json(reservations.map(mapReservationResponse));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reservations' });
  }
};

// ─── Get All Pending Reservations (Staff/Admin) ───────────────────────────────

const getPendingReservations = async (req, res) => {
  try {
    const reservations = await prisma.reservation.findMany({
      where: { status: 'PENDING' },
      include: {
        table: true,
        user: {
          select: {
            id: true, firstName: true, lastName: true,
            email: true, phone: true, gamifiedProfile: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(reservations.map(mapReservationResponse));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pending reservations' });
  }
};

// ─── Get All Reservations (Staff/Admin) ──────────────────────────────────────

const getAllReservations = async (req, res) => {
  try {
    const { status, tableId, date } = req.query;

    const where = {};
    if (status) where.status = status;
    if (tableId) where.tableId = tableId;
    if (date) {
      const d = new Date(date);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      where.startTime = { gte: d, lt: next };
    }

    const reservations = await prisma.reservation.findMany({
      where,
      include: {
        table: true,
        user: {
          select: {
            id: true, firstName: true, lastName: true,
            email: true, phone: true,
          },
        },
      },
      orderBy: { startTime: 'asc' },
    });
    res.json(reservations.map(mapReservationResponse));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reservations' });
  }
};

module.exports = {
  MIN_RESERVATION_DURATION_MS,
  hasMinimumReservationDuration,
  isOnlineReservationPaymentMethod,
  reservationIntervalsOverlap,
  requestReservation,
  approveReservation,
  declineReservation,
  cancelMyReservation,
  getMyReservations,
  getPendingReservations,
  getAllReservations,
};
