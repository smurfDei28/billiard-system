const prisma = require('../config/prisma');

const joinQueue = async (req, res) => {
  const { tableId, partySize, walkinName } = req.body;
  const userId = req.user?.id || null;

  try {
    const lastInQueue = await prisma.queueEntry.findFirst({
      where: { tableId, status: 'WAITING' },
      orderBy: { position: 'desc' },
    });
    const position = lastInQueue ? lastInQueue.position + 1 : 1;

    const entry = await prisma.queueEntry.create({
      data: {
        tableId,
        userId,
        walkinName: walkinName || null,
        partySize: partySize || 1,
        position,
        status: 'WAITING',
      },
      include: { table: true },
    });

    const io = req.app.get('io');
    io.to('tv-display').emit('queue:updated', { tableId, entry });
    io.to('staff-tablet').emit('queue:updated', { tableId, entry });

    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: 'Failed to join queue' });
  }
};

const getQueue = async (req, res) => {
  try {
    const queue = await prisma.queueEntry.findMany({
      where: { status: 'WAITING' },
      orderBy: [{ tableId: 'asc' }, { position: 'asc' }],
      include: {
        table: true,
        user: { select: { id: true, firstName: true, lastName: true, gamifiedProfile: true } },
      },
    });
    res.json(queue);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
};

const getTableQueue = async (req, res) => {
  const { tableId } = req.params;
  try {
    const queue = await prisma.queueEntry.findMany({
      where: { tableId, status: 'WAITING' },
      orderBy: { position: 'asc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, gamifiedProfile: true } },
      },
    });
    res.json(queue);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch table queue' });
  }
};

const removeFromQueue = async (req, res) => {
  const { entryId } = req.params;
  try {
    await prisma.queueEntry.update({
      where: { id: entryId },
      data: { status: 'CANCELLED' },
    });
    const io = req.app.get('io');
    io.to('tv-display').emit('queue:removed', { entryId });
    io.to('staff-tablet').emit('queue:removed', { entryId });
    res.json({ message: 'Removed from queue' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove from queue' });
  }
};

module.exports = { joinQueue, getQueue, getTableQueue, removeFromQueue };
