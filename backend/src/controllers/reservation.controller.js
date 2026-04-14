const prisma = require('../config/prisma');

// ─── Helper ───────────────────────────────────────────────────────────────────

const notify = async (userId, type, title, message, data = {}) => {
  try {
    await prisma.notification.create({ data: { userId, type, title, message, data } });
  } catch (err) {
    console.error('[Notify Error]', err.message);
  }
};

// ─── Member: Request a Reservation ───────────────────────────────────────────

const requestReservation = async (req, res) => {
  const { tableId, startTime, endTime, notes } = req.body;

  if (!tableId || !startTime || !endTime) {
    return res.status(400).json({ error: 'tableId, startTime, and endTime are required' });
  }

  const start = new Date(startTime);
  const end = new Date(endTime);

  // Validate dates are in the future
  if (start <= new Date()) {
    return res.status(400).json({ error: 'Reservation start time must be in the future' });
  }

  if (end <= start) {
    return res.status(400).json({ error: 'End time must be after start time' });
  }

  try {
    const table = await prisma.billiardTable.findUnique({ where: { id: tableId } });
    if (!table) return res.status(404).json({ error: 'Table not found' });
    if (table.status === 'MAINTENANCE') {
      return res.status(400).json({ error: 'This table is currently under maintenance' });
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
        notes: notes || null,
      },
      include: {
        table: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      },
    });

    // Notify the member
    await notify(
      req.user.id,
      'RESERVATION_APPROVED', // reuse type — handled in UI
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
        type: 'RESERVATION_APPROVED',
        title: '📋 New Reservation Request',
        message: `${reservation.user.firstName} ${reservation.user.lastName} requested Table ${table.tableNumber} on ${start.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}.`,
        data: { reservationId: reservation.id },
      })),
    });

    const io = req.app.get('io');
    io.to('staff-tablet').emit('reservation:new', reservation);

    res.status(201).json(reservation);
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

    res.json({ message: 'Reservation approved', reservation: updated });
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

    res.json({ message: 'Reservation declined', reservation: updated });
  } catch (err) {
    console.error('[Decline Reservation Error]', err);
    res.status(500).json({ error: 'Failed to decline reservation' });
  }
};

// ─── Get My Reservations (Member) ────────────────────────────────────────────

const getMyReservations = async (req, res) => {
  try {
    const reservations = await prisma.reservation.findMany({
      where: { userId: req.user.id },
      include: { table: true },
      orderBy: { startTime: 'desc' },
    });
    res.json(reservations);
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
    res.json(reservations);
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
    res.json(reservations);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reservations' });
  }
};

module.exports = {
  requestReservation,
  approveReservation,
  declineReservation,
  getMyReservations,
  getPendingReservations,
  getAllReservations,
};
