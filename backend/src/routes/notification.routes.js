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
  await prisma.notification.update({
    where: { id: req.params.id, userId: req.user.id },
    data: { isRead: true },
  });
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
  const members = await prisma.user.findMany({ where: { role: 'MEMBER' } });
  await prisma.notification.createMany({
    data: members.map((m) => ({
      userId: m.id,
      type: type || 'EVENT_ANNOUNCEMENT',
      title,
      message,
    })),
  });
  const io = req.app.get('io');
  io.emit('notification:broadcast', { title, message });
  res.json({ sent: members.length });
});

module.exports = router;
