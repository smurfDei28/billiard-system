const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../src/routes/member-order.routes.js'), 'utf8');

test('member-order staff routes retain Staff/Admin authorization and MEMBER_SHOP incoming filtering', () => {
  assert.match(source, /router\.get\('\/incoming', authenticate, authorize\('STAFF', 'ADMIN'\)/);
  assert.match(source, /where: \{ source: 'MEMBER_SHOP' \}/);
  assert.match(source, /router\.post\('\/:orderId\/collect-cash', authenticate, authorize\('STAFF', 'ADMIN'\)/);
  assert.match(source, /router\.patch\('\/:orderId\/fulfillment', authenticate, authorize\('STAFF', 'ADMIN'\)/);
});

test('fulfillment route keeps payment gating and its only valid forward transitions', () => {
  assert.match(source, /if \(order\.paymentStatus !== 'PAID'\)/);
  assert.match(source, /ACCEPTED: \['PREPARING'\]/);
  assert.match(source, /PREPARING: \['READY'\]/);
  assert.match(source, /READY: \['COMPLETED'\]/);
  assert.match(source, /Invalid fulfillment transition/);
});
