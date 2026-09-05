const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Get my notifications
router.get('/', authenticate, async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { sentAt: 'desc' },
    take: 50,
  });
  res.json(notifications);
});

// Mark as read
router.patch('/:id/read', authenticate, async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user.id },
    data: { isRead: true },
  });
  if (result.count === 0) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  res.json({ success: true });
});

// Mark all as read
router.patch('/read-all', authenticate, async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user.id, isRead: false },
    data: { isRead: true },
  });
  res.json({ success: true });
});

// Broadcast announcement to all members (admin)
router.post('/broadcast', authenticate, authorize('ADMIN', 'STAFF'), async (req, res) => {
  const { title, message, type } = req.body;
  if (!title?.trim() || !message?.trim()) {
    return res.status(400).json({ error: 'Title and message are required' });
  }

  try {
    const users = await prisma.user.findMany({
      where: { role: { in: ['MEMBER', 'STAFF', 'ADMIN'] } },
      select: { id: true },
    });

    await prisma.notification.createMany({
      data: users.map((user) => ({
        userId: user.id,
        type: type || 'EVENT_ANNOUNCEMENT',
        title: title.trim(),
        message: message.trim(),
      })),
    });

    const io = req.app.get('io');
    io.emit('notification:broadcast', { title: title.trim(), message: message.trim(), type: type || 'EVENT_ANNOUNCEMENT' });
    res.json({ sent: users.length });
  } catch (err) {
    console.error('[Broadcast Notification Error]', err);
    res.status(500).json({ error: 'Failed to broadcast notification' });
  }
});

module.exports = router;
