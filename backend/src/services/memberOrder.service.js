const { randomUUID } = require('crypto');
const { normalizeItems, receiptNumber } = require('../controllers/pos.controller');

const externalMethods = ['CASH', 'GCASH', 'MAYA'];
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const error = (message, status) => Object.assign(new Error(message), { status });
const finalizeLog = (step, details) => {
  if (process.env.NODE_ENV !== 'production') console.log(`[Member Order Finalize] ${step}`, details);
};
const creditsLog = (step, details) => {
  if (process.env.NODE_ENV !== 'production') console.log(`[Member Credits Order] ${step}`, details);
};

const pendingMemberOrder = async (db, { userId, items: rawItems, paymentMethod, note, idempotencyKey }) => {
  const items = normalizeItems(rawItems);
  const method = String(paymentMethod || '').toUpperCase();
  if (!externalMethods.includes(method)) throw error('Choose Cash, GCash, or Maya for a pending external payment.', 400);
  const safeNote = String(note || '').trim();
  if (safeNote.length > 300) throw error('Order notes must be 300 characters or fewer.', 400);
  const safeKey = String(idempotencyKey || '').trim();
  if (safeKey.length > 100) throw error('Invalid checkout request.', 400);
  const marker = safeKey ? `[shop:${safeKey}]` : '';
  if (marker) {
    const existing = await db.order.findFirst({ where: { userId, source: 'MEMBER_SHOP', paymentMethod: method, note: { startsWith: marker } }, include: { items: { include: { product: true } } } });
    if (existing) return existing;
  }
  const products = await db.product.findMany({ where: { id: { in: items.map((item) => item.productId) }, isActive: true } });
  if (products.length !== items.length) throw error('One or more products are unavailable.', 404);
  const total = money(items.reduce((sum, item) => sum + money(products.find((product) => product.id === item.productId).price) * item.quantity, 0));
  return db.order.create({
    data: {
      id: randomUUID(), userId, total, subtotal: total, paymentMethod: method,
      status: 'PENDING_PAYMENT', source: 'MEMBER_SHOP', paymentStatus: 'PENDING', fulfillmentStatus: 'PENDING', note: `${marker}${safeNote}` || null,
      items: { create: items.map((item) => ({ productId: item.productId, quantity: item.quantity, price: products.find((product) => product.id === item.productId).price })) },
    }, include: { items: { include: { product: true } } },
  });
};

const createMemberCreditsOrder = async (tx, { userId, items: rawItems, note, idempotencyKey }) => {
  const items = normalizeItems(rawItems);
  creditsLog('START', { memberId: userId, itemCount: items.length });
  const safeNote = String(note || '').trim();
  if (safeNote.length > 300) throw error('Order notes must be 300 characters or fewer.', 400);
  const safeKey = String(idempotencyKey || '').trim();
  if (safeKey.length > 100) throw error('Invalid checkout request.', 400);
  const marker = safeKey ? `[shop:${safeKey}]` : '';
  if (marker) {
    const existing = await tx.order.findFirst({ where: { userId, source: 'MEMBER_SHOP', paymentMethod: 'LOYALTY_CREDIT', note: { startsWith: marker } }, include: { items: { include: { product: true } } } });
    if (existing) return { order: existing, alreadyFinalized: true };
  }
  const products = await tx.product.findMany({ where: { id: { in: items.map((item) => item.productId) }, isActive: true } });
  if (products.length !== items.length) throw error('One or more products are unavailable.', 404);
  creditsLog('PRODUCTS_VALIDATED', { memberId: userId, itemCount: items.length });
  const total = money(items.reduce((sum, item) => sum + money(products.find((product) => product.id === item.productId).price) * item.quantity, 0));
  const membership = await tx.membership.findUnique({ where: { userId } });
  if (!membership || Number(membership.creditBalance) < total) throw error('Insufficient credits.', 400);
  creditsLog('WALLET_VALIDATED', { memberId: userId, total });
  const id = randomUUID();
  const created = await tx.order.create({ data: { id, userId, total, subtotal: total, receiptNumber: receiptNumber(id), paymentMethod: 'LOYALTY_CREDIT', paidWithCredits: true, status: 'COMPLETED', source: 'MEMBER_SHOP', paymentStatus: 'PAID', fulfillmentStatus: 'ACCEPTED', note: `${marker}${safeNote}` || null, items: { create: items.map((item) => ({ productId: item.productId, quantity: item.quantity, price: products.find((product) => product.id === item.productId).price })) } }, include: { items: { include: { product: true } } } });
  for (const item of items) {
    const claim = await tx.product.updateMany({ where: { id: item.productId, isActive: true, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity } } });
    if (claim.count !== 1) throw error('Some items are out of stock. Please review your cart.', 409);
    creditsLog('STOCK_CLAIMED', { memberId: userId, productId: item.productId, quantity: item.quantity });
    const after = await tx.product.findUnique({ where: { id: item.productId } });
    await tx.stockHistory.create({ data: { productId: item.productId, change: -item.quantity, reason: 'SALE', staffId: null, stockBefore: after.stock + item.quantity, stockAfter: after.stock } });
  }
  const updated = await tx.membership.update({ where: { userId }, data: { creditBalance: { decrement: total } } });
  creditsLog('WALLET_DEDUCTED', { memberId: userId, total });
  await tx.creditTransaction.create({ data: { userId, type: 'DEDUCTION', amount: total, balanceBefore: membership.creditBalance, balanceAfter: updated.creditBalance, description: `Member shop receipt ${created.receiptNumber}`, paymentMethod: 'LOYALTY_CREDIT' } });
  creditsLog('COMPLETE', { memberId: userId, orderId: created.id, total });
  return { order: created, alreadyFinalized: false };
};

// This is deliberately the only path that turns a pending member order into a
// paid sale. It claims stock atomically at payment collection time.
const finalizePendingMemberOrder = async (tx, { orderId, staffId = null }) => {
  finalizeLog('START', { orderId, reviewerId: staffId || 'SYSTEM' });
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: { include: { product: true } } } });
  if (!order) throw error('Order not found.', 404);
  if (order.source !== 'MEMBER_SHOP') throw error('This is not a member shop order.', 400);
  if (order.paymentStatus === 'PAID') return { order, alreadyFinalized: true };
  if (order.paymentStatus !== 'PENDING') throw error('This order cannot be finalized.', 409);
  finalizeLog('ORDER_LOADED', { orderId: order.id, reviewerId: staffId, itemCount: order.items.length });

  for (const item of order.items) {
    const claim = await tx.product.updateMany({ where: { id: item.productId, isActive: true, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity } } });
    if (claim.count !== 1) throw error(`This order can no longer be fulfilled because one or more items are out of stock. Insufficient stock for: ${item.product.name}`, 409);
    finalizeLog('STOCK_CLAIMED', { orderId: order.id, productId: item.productId, quantity: item.quantity });
    const after = await tx.product.findUnique({ where: { id: item.productId } });
    await tx.stockHistory.create({ data: { productId: item.productId, change: -item.quantity, reason: 'SALE', staffId, stockBefore: after.stock + item.quantity, stockAfter: after.stock } });
    finalizeLog('STOCK_HISTORY_CREATED', { orderId: order.id, productId: item.productId });
  }
  finalizeLog('ORDER_UPDATE_START', { orderId: order.id, reviewerId: staffId });
  const updated = await tx.order.update({ where: { id: order.id }, data: {
    staffId, receiptNumber: order.receiptNumber || receiptNumber(order.id), status: 'COMPLETED', paymentStatus: 'PAID', fulfillmentStatus: 'ACCEPTED',
  }, include: { items: { include: { product: true } }, user: { select: { id: true, firstName: true, lastName: true } } } });
  finalizeLog('ORDER_UPDATED', { orderId: order.id, receiptNumber: updated.receiptNumber });
  if (staffId) {
    await tx.staffAction.create({ data: { staffId, action: 'MEMBER_ORDER_PAYMENT_COLLECTED', targetId: order.id, details: { receiptNumber: updated.receiptNumber, total: updated.total, paymentMethod: updated.paymentMethod } } });
    finalizeLog('AUDIT_CREATED', { orderId: order.id, reviewerId: staffId });
  }
  finalizeLog('COMPLETE', { orderId: order.id, reviewerId: staffId || 'SYSTEM' });
  return { order: updated, alreadyFinalized: false };
};

module.exports = { externalMethods, pendingMemberOrder, createMemberCreditsOrder, finalizePendingMemberOrder };
