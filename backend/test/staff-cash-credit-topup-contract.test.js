const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'credit.routes.js'), 'utf8');

test('staff cash credit top-ups accept only positive whole-number cash amounts and retain the existing audit flow', () => {
  assert.match(source, /authorize\('STAFF', 'ADMIN'\)/);
  assert.match(source, /!Number\.isInteger\(parsedAmount\) \|\| parsedAmount <= 0/);
  assert.match(source, /paymentMethod !== 'CASH'/);
  assert.match(source, /paymentMethod: 'CASH'/);
  assert.match(source, /tx\.creditTransaction\.create/);
  assert.match(source, /type: 'TOPUP'/);
  assert.match(source, /tx\.notification\.create/);
  assert.match(source, /action: 'CREDIT_TOPUP'/);
  assert.doesNotMatch(source, /manualPayment/);
});
