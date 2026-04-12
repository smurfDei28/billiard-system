// user.routes.js - User profile management
const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { membership: true, gamifiedProfile: true, loyaltyHistory: { take: 10, orderBy: { createdAt: 'desc' } } },
    });
    const { password, ...safe } = user;
    res.json(safe);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch profile' }); }
});

router.patch('/profile', authenticate, async (req, res) => {
  const { firstName, lastName, phone, pushToken, avatarUrl } = req.body;
  try {
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { firstName, lastName, phone, pushToken, avatarUrl },
    });
    const { password, ...safe } = updated;
    res.json(safe);
  } catch (err) { res.status(500).json({ error: 'Failed to update profile' }); }
});

router.get('/', authenticate, authorize('ADMIN', 'STAFF'), async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, firstName: true, lastName: true, role: true, membership: true, gamifiedProfile: true, createdAt: true },
  });
  res.json(users);
});

module.exports = router;
