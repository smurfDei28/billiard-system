const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCreditBalance } = require('../src/utils/sessionBilling');

test('normalizes exact and decimal table-session credit exhaustion to positive zero', () => {
  assert.equal(normalizeCreditBalance(60 - 60), 0);
  assert.equal(Object.is(normalizeCreditBalance(60 - 60), -0), false);
  assert.equal(normalizeCreditBalance(120.1 - 120.1), 0);
});

test('normalizes tiny floating-point residue but preserves a positive remaining balance', () => {
  assert.equal(normalizeCreditBalance(-0.00000001), 0);
  assert.equal(normalizeCreditBalance(100 - 60), 40);
});

test('does not hide a genuine insufficient-credit balance as zero', () => {
  assert.equal(normalizeCreditBalance(60 - 85), -25);
});

test('repeated monitor and final settlement deductions resolve exact depletion to zero', () => {
  const afterMonitor = normalizeCreditBalance(100 - 60);
  assert.equal(normalizeCreditBalance(afterMonitor - 40), 0);
});
