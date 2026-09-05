const assert = require('node:assert/strict');
const test = require('node:test');
const { pendingMemberOrder, createMemberCreditsOrder, finalizePendingMemberOrder } = require('../src/services/memberOrder.service');

test('member cash order is pending and does not claim stock or require a fake staff id', async () => {
  let created;
  const db = {
    product: { findMany: async () => [{ id: 'coffee', price: 80, isActive: true }] },
    order: { findFirst: async () => null, create: async ({ data }) => { created = data; return data; } },
  };
  await pendingMemberOrder(db, { userId: 'member', paymentMethod: 'CASH', items: [{ productId: 'coffee', quantity: 2 }], note: 'Less sugar' });
  assert.equal(created.staffId, undefined);
  assert.equal(created.source, 'MEMBER_SHOP');
  assert.equal(created.paymentStatus, 'PENDING');
  assert.equal(created.fulfillmentStatus, 'PENDING');
  assert.equal(created.status, 'PENDING_PAYMENT');
  assert.equal(created.total, 160);
});

test('pending external checkout reuses its idempotency-keyed order instead of creating another order', async () => {
  const existing = { id: 'existing-order', source: 'MEMBER_SHOP', paymentMethod: 'GCASH', items: [] };
  const db = {
    order: { findFirst: async () => existing, create: async () => assert.fail('should not create a duplicate order') },
    product: { findMany: async () => assert.fail('should not revalidate a duplicate checkout') },
  };
  const result = await pendingMemberOrder(db, { userId: 'member', paymentMethod: 'GCASH', items: [{ productId: 'coffee', quantity: 1 }], idempotencyKey: 'tap-1' });
  assert.equal(result, existing);
});

test('pending member cash finalization records its staff actor and claims stock once on retry', async () => {
  let stock = 2; let updates = 0; let histories = 0; let stockHistory;
  const order = { id: 'order', source: 'MEMBER_SHOP', paymentStatus: 'PENDING', receiptNumber: null, total: 80, paymentMethod: 'GCASH', items: [{ productId: 'coffee', quantity: 1, product: { name: 'Coffee' } }] };
  const tx = {
    order: {
      findUnique: async () => order,
      update: async ({ data }) => { updates += 1; Object.assign(order, data); return { ...order, items: order.items, user: { id: 'member' } }; },
    },
    product: {
      updateMany: async ({ where }) => { if (stock < where.stock.gte) return { count: 0 }; stock -= where.stock.gte; return { count: 1 }; },
      findUnique: async () => ({ stock }),
    },
    stockHistory: { create: async ({ data }) => { histories += 1; stockHistory = data; } },
    staffAction: { create: async () => {} },
  };
  const first = await finalizePendingMemberOrder(tx, { orderId: 'order', staffId: 'staff' });
  const second = await finalizePendingMemberOrder(tx, { orderId: 'order', staffId: 'staff' });
  assert.equal(first.alreadyFinalized, false);
  assert.equal(second.alreadyFinalized, true);
  assert.equal(stock, 1);
  assert.equal(histories, 1);
  assert.equal(updates, 1);
  assert.equal(order.paymentStatus, 'PAID');
  assert.equal(order.fulfillmentStatus, 'ACCEPTED');
  assert.equal(order.staffId, 'staff');
  assert.match(order.receiptNumber, /^SNB-/);
  assert.equal(stockHistory.staffId, 'staff');
  assert.equal(stockHistory.reason, 'SALE');
});

test('provider-confirmed order finalization uses the same stock path without creating a fake staff audit', async () => {
  let stock = 1; let audits = 0;
  const order = { id: 'order', source: 'MEMBER_SHOP', paymentStatus: 'PENDING', receiptNumber: null, total: 80, paymentMethod: 'GCASH', items: [{ productId: 'coffee', quantity: 1, product: { name: 'Coffee' } }] };
  const tx = {
    order: { findUnique: async () => order, update: async ({ data }) => { Object.assign(order, data); return { ...order, items: order.items, user: { id: 'member' } }; } },
    product: { updateMany: async () => { stock -= 1; return { count: 1 }; }, findUnique: async () => ({ stock }) },
    stockHistory: { create: async ({ data }) => assert.equal(data.staffId, null) },
    staffAction: { create: async () => { audits += 1; } },
  };
  await finalizePendingMemberOrder(tx, { orderId: 'order', staffId: null });
  assert.equal(order.paymentStatus, 'PAID');
  assert.equal(stock, 0);
  assert.equal(audits, 0);
});

test('out of stock cash or digital finalization fails before a member order becomes paid or receives a receipt', async () => {
  const order = { id: 'order', source: 'MEMBER_SHOP', paymentStatus: 'PENDING', items: [{ productId: 'coffee', quantity: 1, product: { name: 'Coffee' } }] };
  let updates = 0; let histories = 0; let audits = 0;
  const tx = {
    order: { findUnique: async () => order, update: async () => { updates += 1; } },
    product: { updateMany: async () => ({ count: 0 }) },
    stockHistory: { create: async () => { histories += 1; } },
    staffAction: { create: async () => { audits += 1; } },
  };
  await assert.rejects(() => finalizePendingMemberOrder(tx, { orderId: 'order', staffId: 'staff' }), /Insufficient stock/);
  assert.equal(order.paymentStatus, 'PENDING');
  assert.equal(order.fulfillmentStatus, undefined);
  assert.equal(order.receiptNumber, undefined);
  assert.equal(updates, 0);
  assert.equal(histories, 0);
  assert.equal(audits, 0);
});

test('low stock is informational: finalization still succeeds for a quantity within stock', async () => {
  let stock = 1;
  const order = { id: 'order', source: 'MEMBER_SHOP', paymentStatus: 'PENDING', receiptNumber: null, total: 80, paymentMethod: 'CASH', items: [{ productId: 'coffee', quantity: 1, product: { name: 'Coffee', lowStockAt: 5 } }] };
  const tx = {
    order: { findUnique: async () => order, update: async ({ data }) => { Object.assign(order, data); return { ...order, items: order.items, user: { id: 'member' } }; } },
    product: { updateMany: async () => { stock -= 1; return { count: 1 }; }, findUnique: async () => ({ stock }) },
    stockHistory: { create: async () => {} }, staffAction: { create: async () => {} },
  };
  await finalizePendingMemberOrder(tx, { orderId: 'order', staffId: 'staff' });
  assert.equal(stock, 0);
  assert.equal(order.paymentStatus, 'PAID');
  assert.equal(order.fulfillmentStatus, 'ACCEPTED');
});

test('member credits checkout atomically records a paid accepted order with member-attributed stock history', async () => {
  let stock = 2; let balance = 500; let history; let transaction;
  const tx = {
    order: { findFirst: async () => null, create: async ({ data }) => ({ ...data, items: data.items.create }) },
    product: { findMany: async () => [{ id: 'coffee', price: 80 }], updateMany: async () => { stock -= 1; return { count: 1 }; }, findUnique: async () => ({ stock }) },
    membership: { findUnique: async () => ({ creditBalance: balance }), update: async () => { balance -= 80; return { creditBalance: balance }; } },
    stockHistory: { create: async ({ data }) => { history = data; } },
    creditTransaction: { create: async ({ data }) => { transaction = data; } },
  };
  const result = await createMemberCreditsOrder(tx, { userId: 'member', items: [{ productId: 'coffee', quantity: 1 }], idempotencyKey: 'tap-1' });
  assert.equal(result.order.paymentStatus, 'PAID');
  assert.equal(result.order.fulfillmentStatus, 'ACCEPTED');
  assert.equal(result.order.source, 'MEMBER_SHOP');
  assert.equal(stock, 1);
  assert.equal(balance, 420);
  assert.equal(history.staffId, null);
  assert.equal(transaction.amount, 80);
});
