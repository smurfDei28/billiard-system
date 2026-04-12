const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Staff adds credits to a member's account
router.post('/topup', authenticate, authorize('STAFF', 'ADMIN'), async (req, res) => {
  const { userId, amount, paymentMethod, referenceNo } = req.body;
  if (!userId || !amount || amount <= 0) {
    return res.status(400).json({ error: 'userId and positive amount are required' });
  }

  try {
    const membership = await prisma.membership.findUnique({ where: { userId } });
    if (!membership) return res.status(404).json({ error: 'Member not found' });

    const updated = await prisma.$transaction(async (tx) => {
      const mem = await tx.membership.update({
        where: { userId },
        data: { creditBalance: { increment: amount } },
      });
      await tx.creditTransaction.create({
        data: {
          userId,
          type: 'TOPUP',
          amount,
          balanceBefore: membership.creditBalance,
          balanceAfter: mem.creditBalance,
          description: `Credit top-up by staff`,
          paymentMethod: paymentMethod || 'CASH',
          referenceNo: referenceNo || null,
          staffId: req.user.id,
        },
      });
      await tx.staffAction.create({
        data: { staffId: req.user.id, action: 'CREDIT_TOPUP', targetId: userId, details: { amount, paymentMethod } },
      });
      return mem;
    });

    res.json({ message: `Added ${amount} credits`, balance: updated.creditBalance });
  } catch (err) {
    res.status(500).json({ error: 'Top-up failed' });
  }
});

// Get credit balance
router.get('/balance', authenticate, async (req, res) => {
  const membership = await prisma.membership.findUnique({ where: { userId: req.user.id } });
  res.json({ balance: membership?.creditBalance ?? 0 });
});

// Get transaction history
router.get('/history', authenticate, async (req, res) => {
  const transactions = await prisma.creditTransaction.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(transactions);
});

module.exports = router;
