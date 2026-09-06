const assert = require('node:assert/strict');
const test = require('node:test');

const sandbox = require('../src/services/gcashSandbox.service');
const prisma = require('../src/config/prisma');

const original = {
  enabled: process.env.GCASH_SANDBOX_ENABLED,
  legacyEnabled: process.env.ACQUIREMOCK_ENABLED,
  scenario: process.env.GCASH_SANDBOX_DEFAULT_SCENARIO,
};

test.afterEach(() => {
  const restore = (key, value) => value === undefined ? delete process.env[key] : process.env[key] = value;
  restore('GCASH_SANDBOX_ENABLED', original.enabled);
  restore('ACQUIREMOCK_ENABLED', original.legacyEnabled);
  restore('GCASH_SANDBOX_DEFAULT_SCENARIO', original.scenario);
});

test('built-in sandbox is disabled unless explicitly enabled', async () => {
  delete process.env.GCASH_SANDBOX_ENABLED;
  delete process.env.ACQUIREMOCK_ENABLED;
  await assert.rejects(
    sandbox.request('/api/payments/gcash/mock', { method: 'POST', body: '{}' }),
    (error) => error.status === 503,
  );
});

test('success scenario returns an automatic paid GCash result', async () => {
  process.env.GCASH_SANDBOX_ENABLED = 'true';
  process.env.GCASH_SANDBOX_DEFAULT_SCENARIO = 'success';
  const result = await sandbox.request('/api/payments/gcash/mock', {
    method: 'POST',
    body: JSON.stringify({ amount: 12500, currency: 'PHP', reference: 'TEST-125' }),
  });
  assert.equal(result.status, 'paid');
  assert.equal(result.amount, 12500);
  assert.equal(result.currency, 'PHP');
  assert.equal(result.environment, 'sandbox');
  assert.match(result.id, /^[0-9a-f-]{36}$/);
});

test('configured failure and pending scenarios produce provider-like states', async () => {
  process.env.GCASH_SANDBOX_ENABLED = 'true';
  process.env.GCASH_SANDBOX_DEFAULT_SCENARIO = 'failed';
  const failed = await sandbox.request('/api/payments/gcash/mock', {
    method: 'POST',
    body: JSON.stringify({ amount: 5000, currency: 'PHP', reference: 'TEST-FAILED' }),
  });
  assert.equal(failed.status, 'failed');
  assert.ok(failed.failureReason);

  process.env.GCASH_SANDBOX_DEFAULT_SCENARIO = 'pending';
  const pending = await sandbox.request('/api/payments/gcash/mock', {
    method: 'POST',
    body: JSON.stringify({ amount: 5000, currency: 'PHP', reference: 'TEST-PENDING' }),
  });
  assert.equal(pending.status, 'pending');
});

test('each new sandbox payment can explicitly choose every test result', async () => {
  process.env.GCASH_SANDBOX_ENABLED = 'true';
  process.env.GCASH_SANDBOX_DEFAULT_SCENARIO = 'success';
  const expectedStatuses = {
    success: 'paid',
    failed: 'failed',
    pending: 'pending',
    cancelled: 'cancelled',
  };

  for (const [scenario, expectedStatus] of Object.entries(expectedStatuses)) {
    const result = await sandbox.request('/api/payments/gcash/mock', {
      method: 'POST',
      body: JSON.stringify({ amount: 20000, currency: 'PHP', reference: `TEST-${scenario}`, scenario }),
    });
    assert.equal(result.scenario, scenario);
    assert.equal(result.status, expectedStatus);
  }

  await assert.rejects(
    sandbox.request('/api/payments/gcash/mock', {
      method: 'POST',
      body: JSON.stringify({ amount: 20000, currency: 'PHP', reference: 'TEST-BAD', scenario: 'maybe' }),
    }),
    (error) => error.status === 400,
  );
});

test('pending records remain pending regardless of age or repeated refreshes', () => {
  const recent = { notes: 'GCASH SANDBOX | scenario=pending | status=pending', createdAt: new Date() };
  const old = { notes: recent.notes, createdAt: new Date(Date.now() - 86400000) };
  assert.equal(sandbox._test.resolvedStatus(recent), 'pending');
  assert.equal(sandbox._test.resolvedStatus(old), 'pending');
  assert.equal(sandbox._test.resolvedStatus(old), 'pending');
});

test('a pending provider record changes to paid only through the explicit complete action', async (t) => {
  process.env.GCASH_SANDBOX_ENABLED = 'true';
  const originalFindFirst = prisma.manualPayment.findFirst;
  prisma.manualPayment.findFirst = async () => ({
    amount: 200,
    referenceNo: 'ACQUIREMOCK-test-provider-id',
    notes: 'GCASH SANDBOX | scenario=pending | status=pending',
    createdAt: new Date(0),
  });
  t.after(() => { prisma.manualPayment.findFirst = originalFindFirst; });

  const firstRefresh = await sandbox.request('/api/payments/gcash/mock/test-provider-id');
  const secondRefresh = await sandbox.request('/api/payments/gcash/mock/test-provider-id');
  const completed = await sandbox.request('/api/payments/gcash/mock/test-provider-id/complete', { method: 'POST' });

  assert.equal(firstRefresh.status, 'pending');
  assert.equal(secondRefresh.status, 'pending');
  assert.equal(completed.status, 'paid');
  assert.equal(completed.scenario, 'success');
});
