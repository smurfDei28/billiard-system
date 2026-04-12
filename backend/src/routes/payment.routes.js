const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate } = require('../middleware/auth.middleware');

const PAYMONGO_SECRET = process.env.PAYMONGO_SECRET_KEY;
const PAYMONGO_BASE = 'https://api.paymongo.com/v1';

const paymongoHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Basic ${Buffer.from(PAYMONGO_SECRET + ':').toString('base64')}`,
});

// Create a GCash/Maya payment link for credit top-up
router.post('/create-link', authenticate, async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || amount < 20) return res.status(400).json({ error: 'Minimum payment is ₱20' });
  if (!PAYMONGO_SECRET) return res.status(503).json({ error: 'Online payment not configured' });

  try {
    const response = await fetch(`${PAYMONGO_BASE}/links`, {
      method: 'POST',
      headers: paymongoHeaders(),
      body: JSON.stringify({
        data: {
          attributes: {
            amount: Math.round(amount * 100), // convert to centavos
            description: description || `Saturday Nights Billiard - Credit Top-up`,
            remarks: `User: ${req.user.id}`,
          },
        },
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(400).json({ error: err.errors?.[0]?.detail || 'PayMongo error' });
    }

    const data = await response.json();
    const link = data.data;

    // Save pending transaction
    await prisma.creditTransaction.create({
      data: {
        userId: req.user.id,
        type: 'TOPUP',
        amount,
        balanceBefore: 0,
        balanceAfter: 0,
        description: `Online top-up via ${description || 'PayMongo'}`,
        paymentMethod: 'ONLINE',
        referenceNo: link.id,
        status: 'PENDING',
      },
    });

    res.json({
      linkId: link.id,
      checkoutUrl: link.attributes.checkout_url,
      amount,
      expiresAt: link.attributes.created_at + 86400,
    });
  } catch (err) {
    console.error('PayMongo error:', err);
    res.status(500).json({ error: 'Failed to create payment link' });
  }
});

// Webhook: PayMongo calls this when payment succeeds
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = JSON.parse(req.body.toString());
    const eventType = event.data?.attributes?.type;

    if (eventType === 'link.payment.paid') {
      const linkId = event.data?.attributes?.data?.id;
      const amountPaid = event.data?.attributes?.data?.attributes?.amount / 100;

      // Find the pending transaction
      const pendingTx = await prisma.creditTransaction.findFirst({
        where: { referenceNo: linkId, status: 'PENDING' },
      });

      if (pendingTx) {
        const membership = await prisma.membership.findUnique({ where: { userId: pendingTx.userId } });
        await prisma.$transaction(async (tx) => {
          const mem = await tx.membership.update({
            where: { userId: pendingTx.userId },
            data: { creditBalance: { increment: amountPaid } },
          });
          await tx.creditTransaction.update({
            where: { id: pendingTx.id },
            data: { status: 'COMPLETED', balanceBefore: membership.creditBalance, balanceAfter: mem.creditBalance },
          });
          await tx.notification.create({
            data: {
              userId: pendingTx.userId, type: 'SYSTEM',
              title: '✅ Payment Received',
              message: `₱${amountPaid} added to your account. New balance: ${mem.creditBalance} credits.`,
            },
          });
        });
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(500);
  }
});

// Check payment status
router.get('/status/:linkId', authenticate, async (req, res) => {
  try {
    const tx = await prisma.creditTransaction.findFirst({
      where: { referenceNo: req.params.linkId, userId: req.user.id },
    });
    res.json({ status: tx?.status || 'NOT_FOUND', amount: tx?.amount });
  } catch { res.status(500).json({ error: 'Failed to check status' }); }
});

module.exports = router;
