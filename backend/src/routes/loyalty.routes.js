const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Get my loyalty history
router.get('/history', authenticate, async (req, res) => {
  try {
    const history = await prisma.loyaltyHistory.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(history);
  } catch { res.status(500).json({ error: 'Failed to fetch loyalty history' }); }
});

// Admin: manually grant loyalty reward
router.post('/grant', authenticate, authorize('ADMIN', 'STAFF'), async (req, res) => {
  const { userId, trigger, creditsAwarded, description } = req.body;
  if (!userId || !creditsAwarded) return res.status(400).json({ error: 'userId and creditsAwarded required' });
  try {
    const membership = await prisma.membership.findUnique({ where: { userId } });
    if (!membership) return res.status(404).json({ error: 'Member not found' });

    const result = await prisma.$transaction(async (tx) => {
      const mem = await tx.membership.update({ where: { userId }, data: { creditBalance: { increment: creditsAwarded } } });
      const lh = await tx.loyaltyHistory.create({
        data: { userId, trigger: trigger || 'MANUAL_GRANT', creditsAwarded, description: description || 'Manual reward by staff' },
      });
      await tx.creditTransaction.create({
        data: {
          userId, type: 'LOYALTY_REWARD', amount: creditsAwarded,
          balanceBefore: membership.creditBalance, balanceAfter: mem.creditBalance,
          description: description || 'Loyalty reward',
        },
      });
      await tx.notification.create({
        data: { userId, type: 'LOYALTY_EARNED', title: '🎁 Loyalty Reward!', message: description || `You received ${creditsAwarded} bonus credits!` },
      });
      return lh;
    });
    res.status(201).json(result);
  } catch { res.status(500).json({ error: 'Failed to grant reward' }); }
});

// Birthday check & award (called on login in auth controller, but also callable manually)
router.post('/birthday-check', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.dateOfBirth) return res.json({ awarded: false, reason: 'No birthday set' });

    const today = new Date();
    const dob = new Date(user.dateOfBirth);
    const isBirthday = today.getMonth() === dob.getMonth() && today.getDate() === dob.getDate();
    if (!isBirthday) return res.json({ awarded: false, reason: 'Not your birthday today' });

    // Check if already awarded this year
    const thisYear = today.getFullYear();
    const alreadyAwarded = await prisma.loyaltyHistory.findFirst({
      where: {
        userId: req.user.id, trigger: 'BIRTHDAY',
        createdAt: { gte: new Date(`${thisYear}-01-01`), lte: new Date(`${thisYear}-12-31`) },
      },
    });
    if (alreadyAwarded) return res.json({ awarded: false, reason: 'Already awarded this year' });

    const freeCredits = 60;
    const membership = await prisma.membership.findUnique({ where: { userId: req.user.id } });
    await prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { userId: req.user.id }, data: { creditBalance: { increment: freeCredits } } });
      await tx.loyaltyHistory.create({ data: { userId: req.user.id, trigger: 'BIRTHDAY', creditsAwarded: freeCredits, description: '🎂 Happy Birthday! Enjoy 1 free hour.' } });
      await tx.creditTransaction.create({ data: { userId: req.user.id, type: 'LOYALTY_REWARD', amount: freeCredits, balanceBefore: membership.creditBalance, balanceAfter: membership.creditBalance + freeCredits, description: 'Birthday reward - 1 free hour' } });
      await tx.notification.create({ data: { userId: req.user.id, type: 'BIRTHDAY_REWARD', title: '🎂 Happy Birthday!', message: 'Enjoy 1 free hour of play on us!' } });
    });
    res.json({ awarded: true, credits: freeCredits });
  } catch { res.status(500).json({ error: 'Birthday check failed' }); }
});

module.exports = router;
