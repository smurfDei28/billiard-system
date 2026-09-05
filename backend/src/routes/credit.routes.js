const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { settlePendingCancellationFees } = require('../utils/cancellationFees');

// Staff adds credits to a member's account
router.post('/topup', authenticate, authorize('STAFF', 'ADMIN'), async (req, res) => {
  const { userId, amount, paymentMethod } = req.body;
  const parsedAmount = Number(amount);
  if (!userId || !Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: 'userId and a positive whole-number amount are required' });
  }

  if (paymentMethod !== 'CASH') {
    return res.status(400).json({ error: 'Staff credit top-ups must use cash payment' });
  }

  try {
    const membership = await prisma.membership.findUnique({ where: { userId } });
    if (!membership) return res.status(404).json({ error: 'Member not found' });

    const updated = await prisma.$transaction(async (tx) => {
      const mem = await tx.membership.update({
        where: { userId },
        data: {
          creditBalance: { increment: parsedAmount },
        },
      });
      await tx.creditTransaction.create({
        data: {
          userId,
          type: 'TOPUP',
          amount: parsedAmount,
          balanceBefore: membership.creditBalance,
          balanceAfter: mem.creditBalance,
          description: `Credit top-up by staff`,
          paymentMethod: 'CASH',
          referenceNo: null,
          staffId: req.user.id,
        },
      });
      const settlement = await settlePendingCancellationFees(tx, userId, req.user.id);
      await tx.notification.create({
        data: {
          userId,
          type: 'TOPUP_SUCCESS',
          title: 'Top-up Successful',
          message: `Your account has been credited with ${parsedAmount} credits. New balance: ${settlement.balance ?? mem.creditBalance} credits.`,
          data: {
            amount: parsedAmount,
            balance: settlement.balance ?? mem.creditBalance,
            paymentMethod: 'CASH',
          },
        },
      });
      await tx.staffAction.create({
        data: { staffId: req.user.id, action: 'CREDIT_TOPUP', targetId: userId, details: { amount: parsedAmount, paymentMethod: 'CASH' } },
      });
      return { membership: mem, settlement };
    });

    res.json({ message: `Added ${amount} credits`, balance: updated.settlement.balance ?? updated.membership.creditBalance, cancellationFeesPaid: updated.settlement.paid });
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
