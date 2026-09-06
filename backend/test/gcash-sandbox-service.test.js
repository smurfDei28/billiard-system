const assert = require('node:assert/strict');
const test = require('node:test');

const sandbox = require('../src/services/gcashSandbox.service');

const original = {
  enabled: process.env.GCASH_SANDBOX_ENABLED,
  legacyEnabled: process.env.ACQUIREMOCK_ENABLED,
  scenario: process.env.GCASH_SANDBOX_DEFAULT_SCENARIO,
  pendingSeconds: process.env.GCASH_SANDBOX_PENDING_SECONDS,
};

test.afterEach(() => {
  const restore = (key, value) => value === undefined ? delete process.env[key] : process.env[key] = value;
  restore('GCASH_SANDBOX_ENABLED', original.enabled);
  restore('ACQUIREMOCK_ENABLED', original.legacyEnabled);
  restore('GCASH_SANDBOX_DEFAULT_SCENARIO', original.scenario);
  restore('GCASH_SANDBOX_PENDING_SECONDS', original.pendingSeconds);
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

test('pending records automatically resolve after the configured delay', () => {
  process.env.GCASH_SANDBOX_PENDING_SECONDS = '10';
  const recent = { notes: 'GCASH SANDBOX | scenario=pending | status=pending', createdAt: new Date() };
  const old = { notes: recent.notes, createdAt: new Date(Date.now() - 11000) };
  assert.equal(sandbox._test.resolvedStatus(recent), 'pending');
  assert.equal(sandbox._test.resolvedStatus(old), 'paid');
});
