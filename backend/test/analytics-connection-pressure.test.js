const assert = require('node:assert/strict');
const test = require('node:test');
const { reportData } = require('../src/controllers/analytics.controller');

test('analytics revenue reads are serialized to avoid consuming the session pool', async () => {
  let active = 0;
  let peak = 0;
  const query = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return [];
  };
  const db = {
    order: { findMany: query },
    creditTransaction: { findMany: query },
    manualPayment: { findMany: query },
    tableSession: { findMany: query },
  };

  const rows = await reportData(new Date('2026-08-01'), new Date('2026-08-02'), db);
  assert.equal(rows.length, 5);
  assert.equal(peak, 1);
});
