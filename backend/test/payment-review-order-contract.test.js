const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'payment.routes.js'),
  'utf8',
);

test('ORDER payment approval finalizes with the authenticated reviewer before recording the payment audit', () => {
  const orderBranch = source.slice(
    source.indexOf("if (approved && payment.purpose === 'ORDER')"),
    source.indexOf("// Retain this branch only", source.indexOf("if (approved && payment.purpose === 'ORDER')")),
  );

  assert.match(orderBranch, /finalizePendingMemberOrder\(tx, \{ orderId: payment\.orderId, staffId: req\.user\.id \}\)/);
  assert.match(source, /action: approved \? 'MANUAL_PAYMENT_APPROVED'/);
});

test('payment review has enough interactive transaction time for ORDER finalization and audit writes', () => {
  assert.match(source, /\}, \{ maxWait: 10000, timeout: 20000 \}\);/);
  assert.match(source, /logPaymentReview\('ORDER_FINALIZE_START'/);
  assert.match(source, /logPaymentReview\('PAYMENT_AUDIT_CREATED'/);
});
