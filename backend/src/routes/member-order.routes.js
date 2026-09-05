const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { pendingMemberOrder, createMemberCreditsOrder, finalizePendingMemberOrder } = require('../services/memberOrder.service');

const router = express.Router();

router.post('/', authenticate, authorize('MEMBER'), async (req, res) => {
  try {
    const credits = String(req.body.paymentMethod || '').toUpperCase() === 'CREDITS';
    const result = credits
      ? await prisma.$transaction(
        (tx) => createMemberCreditsOrder(tx, { userId: req.user.id, ...req.body }),
        { maxWait: 10000, timeout: 20000 },
      )
      : await prisma.$transaction((tx) => pendingMemberOrder(tx, { userId: req.user.id, ...req.body }).then((order) => ({ order, alreadyFinalized: false })));
    const sandboxPending = !credits && String(req.body.paymentMethod || '').toUpperCase() === 'GCASH';
    if (!result.alreadyFinalized) await prisma.notification.create({ data: { userId: req.user.id, type: 'PAYMENT_RECEIVED', title: credits ? 'Order paid' : 'Order received', message: credits ? 'Your credit payment was accepted and your order is ready for preparation.' : 'Your order is waiting for payment confirmation.', data: { orderId: result.order.id, ...(sandboxPending ? { paymentStatus: 'PENDING', sandbox: 'ACQUIREMOCK' } : {}) }, actionRoute: 'Payments' } });
    res.status(result.alreadyFinalized ? 200 : 201).json(result);
  } catch (err) {
    console.error('[Member Order Checkout] failed', { memberId: req.user.id, paymentMethod: req.body.paymentMethod, name: err.name, code: err.code, meta: err.meta, message: err.message, stack: err.stack });
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not place order. Please try again.' });
  }
});

router.get('/mine', authenticate, authorize('MEMBER'), async (req, res) => {
  try {
    const orders = await prisma.order.findMany({ where: { userId: req.user.id, source: 'MEMBER_SHOP' }, include: { items: { include: { product: true } }, manualPayments: { select: { id: true, status: true, method: true, referenceNo: true, notes: true, createdAt: true }, orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    res.json(orders);
  } catch { res.status(500).json({ error: 'Could not load your orders.' }); }
});

router.get('/incoming', authenticate, authorize('STAFF', 'ADMIN'), async (_req, res) => {
  try {
    const orders = await prisma.order.findMany({ where: { source: 'MEMBER_SHOP' }, include: { user: { select: { firstName: true, lastName: true } }, items: { include: { product: true } }, manualPayments: { select: { method: true, referenceNo: true } } }, orderBy: [{ paymentStatus: 'asc' }, { createdAt: 'desc' }], take: 100 });
    res.json(orders);
  } catch { res.status(500).json({ error: 'Could not load incoming orders.' }); }
});

router.post('/:orderId/collect-cash', authenticate, authorize('STAFF', 'ADMIN'), async (req, res) => {
  try {
    const pending = await prisma.order.findUnique({ where: { id: req.params.orderId }, select: { paymentMethod: true } });
    if (!pending) return res.status(404).json({ error: 'Order not found.' });
    if (pending.paymentMethod !== 'CASH') return res.status(400).json({ error: 'Only Cash orders can be collected through this action.' });
    const result = await prisma.$transaction(
      (tx) => finalizePendingMemberOrder(tx, { orderId: req.params.orderId, staffId: req.user.id }),
      { maxWait: 10000, timeout: 20000 },
    );
    if (!result.alreadyFinalized) await prisma.notification.create({ data: { userId: result.order.userId, type: 'PAYMENT_RECEIVED', title: 'Order payment confirmed', message: `Your order ${result.order.receiptNumber} has been accepted for preparation.`, data: { orderId: result.order.id } } });
    res.json(result);
  } catch (err) {
    console.error('[Member Order Finalize] failed', { orderId: req.params.orderId, reviewerId: req.user.id, name: err.name, code: err.code, meta: err.meta, message: err.message, stack: err.stack });
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not collect order payment. Please try again.' });
  }
});

router.patch('/:orderId/fulfillment', authenticate, authorize('STAFF', 'ADMIN'), async (req, res) => {
  const next = String(req.body.fulfillmentStatus || '').toUpperCase();
  const allowed = { ACCEPTED: ['PREPARING'], PREPARING: ['READY'], READY: ['COMPLETED'] };
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.orderId } });
    if (!order || order.source !== 'MEMBER_SHOP') return res.status(404).json({ error: 'Member order not found.' });
    if (order.paymentStatus !== 'PAID') return res.status(409).json({ error: 'Payment must be confirmed before fulfillment.' });
    if (order.fulfillmentStatus === next) return res.json({ order, alreadyUpdated: true });
    if (!allowed[order.fulfillmentStatus]?.includes(next)) return res.status(409).json({ error: 'Invalid fulfillment transition.' });
    const updated = await prisma.order.update({ where: { id: order.id }, data: { fulfillmentStatus: next, staffId: req.user.id } });
    await prisma.notification.create({ data: { userId: order.userId, type: 'PAYMENT_RECEIVED', title: `Order ${next.toLowerCase()}`, message: `Your order is now ${next.toLowerCase()}.`, data: { orderId: order.id } } });
    res.json({ order: updated });
  } catch (err) { res.status(500).json({ error: err.message || 'Could not update fulfillment.' }); }
});

module.exports = router;
