const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'tournament.controller.js'), 'utf8');

test('new paid tournament registrations accept only Credits or Cash', () => {
  assert.match(source, /NEW_TOURNAMENT_REGISTRATION_PAYMENT_METHODS = \['CREDITS', 'CASH'\]/);
  assert.match(source, /!NEW_TOURNAMENT_REGISTRATION_PAYMENT_METHODS\.includes\(normalizedMethod\)/);
  assert.match(source, /Tournament registration payment must use Credits or Cash\./);
  assert.match(source, /Select Credits or Cash for tournament registration\./);
});

test('Credits registration retains its atomic wallet deduction while Cash remains pending without a wallet deduction', () => {
  assert.match(source, /normalizedMethod === 'CREDITS' && hasFee/);
  assert.match(source, /creditBalance: \{ decrement: tournament\.entryFee \}/);
  assert.match(source, /paymentMethod: 'LOYALTY_CREDIT'/);
  assert.match(source, /status: entryStatus, paymentMethod: normalizedMethod \|\| null, paymentRef: null, paidAt: null/);
  assert.match(source, /entry\.status === 'PENDING_PAYMENT' \? new Date\(\) : undefined/);
});
