const prisma = require('../config/prisma');

// WAITING and CALLED are both active waiting states.  A CALLED member is still
// waiting until the table session has actually been created.
const ACTIVE_QUEUE_STATUSES = ['WAITING', 'CALLED'];

const enrichQueueEntries = async (entries) => {
  const userIds = [...new Set(entries.map((entry) => entry.userId).filter(Boolean))];
  if (!userIds.length) return entries;

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true, firstName: true, lastName: true,
      membership: { select: { creditBalance: true, status: true, plan: true } },
      gamifiedProfile: { select: { rank: true, totalWins: true } },
    },
  });
  const usersById = new Map(users.map((user) => [user.id, user]));
  return entries.map((entry, index) => ({
    ...entry,
    // Queue order is derived from the ordered active records, rather than from
    // a stale position left behind by a cancelled or seated record.
    position: index + 1,
    user: entry.userId ? usersById.get(entry.userId) || null : null,
  }));
};

const activeQueueOrder = { joinedAt: 'asc' };

// Reservations are the authoritative schedule for future table use. QueueEntry
// remains available for historical/legacy operational records only.
const buildReservationQueue = (reservations) => {
  const byTable = new Map();
  for (const reservation of reservations) {
    byTable.set(reservation.tableId, [...(byTable.get(reservation.tableId) || []), reservation]);
  }
  return [...byTable.values()].flatMap((tableReservations) =>
    tableReservations
      .sort((left, right) => new Date(left.startTime) - new Date(right.startTime))
      .map((reservation, index) => ({ ...reservation, position: index + 1 }))
  );
};

const emitQueueUpdated = (io, tableId) => {
  // Queue state is already available to authenticated member, staff, and TV
  // screens. Emit the one authoritative refresh event to every connected app;
  // member QueueScreen subscribes to this event but does not belong to a staff
  // or TV room.
  io?.emit('queue:updated', { tableId });
};

const joinQueue = async (req, res) => {
  const { tableId, partySize, walkinName } = req.body;
  const userId = req.user?.id || null;
  if (!tableId) return res.status(400).json({ error: 'tableId is required' });
  if (!userId && !walkinName?.trim()) return res.status(400).json({ error: 'A member or walk-in name is required' });

  try {
    // The transaction-level advisory lock serializes joins for one member/table
    // without blocking queues for other tables. The partial unique index in the
    // migration is the durable second line of defence across requests/devices.
    const result = await prisma.$transaction(async (tx) => {
      if (userId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`queue:${tableId}:${userId}`}))`;
      const table = await tx.billiardTable.findUnique({ where: { id: tableId } });
      if (!table) return { missing: true };

      if (userId) {
        const existing = await tx.queueEntry.findFirst({
          where: { tableId, userId, status: { in: ACTIVE_QUEUE_STATUSES } },
          orderBy: activeQueueOrder,
        });
        if (existing) return { existing, table };
      }

      const activeEntries = await tx.queueEntry.findMany({
        where: { tableId, status: { in: ACTIVE_QUEUE_STATUSES } },
        orderBy: activeQueueOrder,
        select: { id: true },
      });
      const entry = await tx.queueEntry.create({
        data: {
          tableId, userId, walkinName: walkinName?.trim() || null,
          partySize: Math.max(1, Number.parseInt(partySize, 10) || 1),
          position: activeEntries.length + 1, status: 'WAITING',
        },
      });
      return { entry, table };
    });

    if (result.missing) return res.status(404).json({ error: 'Table not found' });
    const entry = result.existing || result.entry;
    const activeEntries = await prisma.queueEntry.findMany({
      where: { tableId, status: { in: ACTIVE_QUEUE_STATUSES } },
      orderBy: activeQueueOrder,
    });
    const fullEntry = (await enrichQueueEntries(activeEntries)).find((candidate) => candidate.id === entry.id);
    emitQueueUpdated(req.app.get('io'), tableId);

    // A vacant table uses the existing CALLED/ staff-start workflow; it never
    // needs to be marked occupied artificially first.
    if (!result.existing && result.table.status === 'AVAILABLE') {
      await callFirstWaitingForAvailableTable(tableId, req.app.get('io'));
    }

    return res.status(result.existing ? 200 : 201).json({
      ...fullEntry,
      alreadyQueued: Boolean(result.existing),
      message: result.existing ? 'You are already in the queue for this table.' : undefined,
    });
  } catch (err) {
    // Covers a concurrent insert if an older deployment reaches the database
    // before the advisory lock/index is available.
    if (err.code === 'P2002' && userId) {
      const existing = await prisma.queueEntry.findFirst({ where: { tableId, userId, status: { in: ACTIVE_QUEUE_STATUSES } }, include: { table: true }, orderBy: activeQueueOrder });
      if (existing) {
        const [fullEntry] = await enrichQueueEntries([existing]);
        return res.json({ ...fullEntry, alreadyQueued: true, message: 'You are already in the queue for this table.' });
      }
    }
    console.error('[Join Queue Error]', err);
    return res.status(500).json({ error: 'Failed to join queue' });
  }
};

const getQueue = async (req, res) => {
  try {
    const reservations = await prisma.reservation.findMany({
      where: { status: { in: ['PENDING', 'APPROVED'] }, startTime: { gt: new Date() } },
      orderBy: [{ tableId: 'asc' }, { startTime: 'asc' }],
      include: {
        table: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    res.json(buildReservationQueue(reservations));
  } catch (err) { console.error('[Get Queue Error]', err); res.status(500).json({ error: 'Failed to fetch queue' }); }
};

const getTableQueue = async (req, res) => {
  try {
    const reservations = await prisma.reservation.findMany({
      where: { tableId: req.params.tableId, status: { in: ['PENDING', 'APPROVED'] }, startTime: { gt: new Date() } },
      orderBy: { startTime: 'asc' },
      include: { table: true, user: { select: { id: true, firstName: true, lastName: true } } },
    });
    res.json(buildReservationQueue(reservations));
  } catch (err) { console.error('[Get Table Queue Error]', err); res.status(500).json({ error: 'Failed to fetch table queue' }); }
};

const callFirstWaitingForAvailableTable = async (tableId, io) => {
  const updated = await prisma.$transaction(async (tx) => {
    const table = await tx.billiardTable.findUnique({ where: { id: tableId } });
    if (!table || table.status !== 'AVAILABLE') return null;
    const called = await tx.queueEntry.findFirst({ where: { tableId, status: 'CALLED' }, orderBy: activeQueueOrder });
    if (called) return null; // idempotent notification
    const next = await tx.queueEntry.findFirst({ where: { tableId, status: 'WAITING' }, orderBy: activeQueueOrder, include: { table: true } });
    if (!next) return null;
    return tx.queueEntry.update({ where: { id: next.id }, data: { status: 'CALLED', notifiedAt: new Date() }, include: { table: true } });
  });
  if (!updated) return null;
  if (updated.userId) await prisma.notification.create({ data: { userId: updated.userId, type: 'QUEUE_UPDATE', title: 'Your table is ready', message: `Table ${updated.table.tableNumber} is ready for you. Please proceed to the staff desk.`, data: { tableId, queueEntryId: updated.id }, actionRoute: 'Queue' } });
  const [fullEntry] = await enrichQueueEntries([updated]);
  io?.emit('queue:called', { tableId, entry: fullEntry });
  emitQueueUpdated(io, tableId);
  return fullEntry;
};

const callQueueEntry = async (req, res) => {
  try {
    const entry = await prisma.queueEntry.findUnique({ where: { id: req.params.entryId }, include: { table: true } });
    if (!entry) return res.status(404).json({ error: 'Queue entry not found' });
    if (entry.status === 'CALLED') return res.json(await enrichQueueEntries([entry]).then(([value]) => value));
    if (entry.status !== 'WAITING') return res.status(400).json({ error: 'Only waiting entries can be called' });
    const first = await prisma.queueEntry.findFirst({ where: { tableId: entry.tableId, status: 'WAITING' }, orderBy: activeQueueOrder });
    if (!first || first.id !== entry.id) return res.status(400).json({ error: 'Only the first waiting member can be called' });
    const result = await callFirstWaitingForAvailableTable(entry.tableId, req.app.get('io'));
    if (!result) return res.status(409).json({ error: 'The table is not available or another member has already been called' });
    res.json(result);
  } catch (err) { console.error('[Call Queue Entry Error]', err); res.status(500).json({ error: 'Failed to call next in queue' }); }
};

const removeEntry = async (req, res, allowOwnEntry) => {
  try {
    const entry = await prisma.queueEntry.findUnique({ where: { id: req.params.entryId } });
    if (!entry) return res.status(404).json({ error: 'Queue entry not found' });
    if (allowOwnEntry && entry.userId !== req.user.id) return res.status(403).json({ error: 'You can only leave your own queue entry' });
    if (!ACTIVE_QUEUE_STATUSES.includes(entry.status)) return res.json({ message: 'Queue entry is already inactive' });
    await prisma.queueEntry.updateMany({ where: { id: entry.id, status: { in: ACTIVE_QUEUE_STATUSES } }, data: { status: 'CANCELLED' } });
    emitQueueUpdated(req.app.get('io'), entry.tableId);
    res.json({ message: 'Removed from queue' });
  } catch (err) { console.error('[Remove Queue Entry Error]', err); res.status(500).json({ error: 'Failed to remove from queue' }); }
};

const removeFromQueue = (req, res) => removeEntry(req, res, false);
const leaveQueue = (req, res) => removeEntry(req, res, true);

module.exports = { ACTIVE_QUEUE_STATUSES, buildReservationQueue, joinQueue, getQueue, getTableQueue, callQueueEntry, removeFromQueue, leaveQueue, callFirstWaitingForAvailableTable, emitQueueUpdated };
