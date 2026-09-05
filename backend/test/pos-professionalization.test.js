const assert = require('node:assert/strict');
const test = require('node:test');
const { POS_PAYMENT_METHODS, receiptNumber, normalizeItems } = require('../src/controllers/pos.controller');
const { summarizeRevenue } = require('../src/utils/revenueReporting');

test('POS exposes Cash, wallet credits, and existing digital methods without Card', () => {
  assert.deepEqual(POS_PAYMENT_METHODS, ['CASH', 'GCASH', 'MAYA', 'LOYALTY_CREDIT']);
  assert.equal(POS_PAYMENT_METHODS.includes('CARD'), false);
});

test('receipt references are stable and duplicate cart lines are normalized before stock claims', () => {
  assert.equal(receiptNumber('12345678-0000-0000-0000-000000000000', new Date('2026-08-08T10:00:00Z')), 'SNB-20260808-12345678');
  assert.deepEqual(normalizeItems([{ productId: 'drink', quantity: 1 }, { productId: 'drink', quantity: 2 }]), [{ productId: 'drink', quantity: 3 }]);
  assert.throws(() => normalizeItems([{ productId: 'drink', quantity: 0 }]), /valid productId/);
});

test('credit-paid POS sales stay out of cash revenue while preserving POS sales value', () => {
  const result = summarizeRevenue({ orders: [{ total: 150, paymentMethod: 'LOYALTY_CREDIT', paidWithCredits: true }] });
  assert.equal(result.posSalesValue, 150);
  assert.equal(result.cashRevenue, 0);
});
