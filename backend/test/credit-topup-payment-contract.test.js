const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'payment.routes.js'), 'utf8');

test('member credit top-ups require whole positive credits and a configured QR method', () => {
  assert.match(source, /purpose === 'CREDIT_TOPUP' && !Number\.isInteger\(parsedAmount\)/);
  assert.match(source, /'Credit top-ups must use a whole number of credits\.'/);
  assert.match(source, /purpose === 'CREDIT_TOPUP' && !QR_METHODS\.includes\(normalizedMethod\)/);
  assert.match(source, /'Credit top-ups are available through GCash or Maya only\.'/);
});
