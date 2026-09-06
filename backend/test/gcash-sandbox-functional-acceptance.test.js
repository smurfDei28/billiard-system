const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sandbox = require('../src/services/gcashSandbox.service');
const read = (...segments) => fs.readFileSync(path.join(__dirname, '..', ...segments), 'utf8');
const paymentRoutes = read('src', 'routes', 'payment.routes.js');
const serviceSource = read('src', 'services', 'gcashSandbox.service.js');
const sheetSource = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'components', 'GCashSandboxSheet.tsx'), 'utf8');
const paymentScreen = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'screens', 'member', 'ManualPaymentScreen.tsx'), 'utf8');
const shopScreen = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'screens', 'member', 'ShopScreen.tsx'), 'utf8');

test('FT-SBOX-TOPUP-002 — Failed Payment - No Credits Added', () => {
  assert.equal(sandbox._test.statusForScenario('failed'), 'failed');
  assert.match(paymentRoutes, /status === 'failed' \|\| normalizedAcquirePayment\.status === 'cancelled'[\s\S]*status: 'REJECTED'/);
  assert.match(paymentRoutes, /if \(normalizedAcquirePayment\.status === 'paid'\) \{[\s\S]*finalizeCreditTopup/);
});

test('FT-SBOX-TOPUP-003 — Pending Payment - No Credits Added', () => {
  const record = { notes: 'GCASH SANDBOX | scenario=pending | status=pending', createdAt: new Date(0) };
  assert.equal(sandbox._test.resolvedStatus(record), 'pending');
  assert.match(paymentRoutes, /else \{\s*await tx\.manualPayment\.updateMany/);
  assert.doesNotMatch(serviceSource, /ageSeconds|GCASH_SANDBOX_PENDING_SECONDS/);
});

test('FT-SBOX-TOPUP-004 — Refresh Pending Payment', () => {
  assert.match(paymentRoutes, /router\.get\('\/sandbox\/gcash\/:paymentId'/);
  assert.match(paymentScreen, /const refreshSandbox = async/);
  assert.doesNotMatch(sheetSource, /setTimeout\(onRefresh/);
});

test('FT-SBOX-TOPUP-005 — Cancel Pending Payment', () => {
  assert.match(paymentRoutes, /router\.post\('\/sandbox\/gcash\/:paymentId\/cancel'/);
  assert.match(serviceSource, /match\[2\] === '\/cancel'[\s\S]*cancelPayment/);
});

test('FT-SBOX-SHOP-002 — Failed Sandbox Checkout', () => {
  assert.equal(sandbox._test.statusForScenario('failed'), 'failed');
  assert.match(paymentRoutes, /synchronizeSandboxOrderPayment[\s\S]*status: 'REJECTED'/);
});

test('FT-SBOX-SHOP-007 — Retry Payment After Failure', () => {
  assert.match(sheetSource, /status === "failed" \|\| status === "cancelled"/);
  assert.match(sheetSource, /Try again/);
  assert.match(shopScreen, /const retrySandboxOrder = async/);
});

test('FT-SBOX-SHOP-008 — Same Order Retained on Retry', () => {
  const retry = shopScreen.slice(shopScreen.indexOf('const retrySandboxOrder'), shopScreen.indexOf('const filtered'));
  assert.match(retry, /sandboxOrderPayment\.order\.id/);
  assert.match(retry, /\/api\/payments\/sandbox\/gcash\/order\//);
});

test('FT-SBOX-SHOP-009 — New Attempt on Retry', () => {
  assert.match(paymentRoutes, /status: 'PENDING'.*referenceNo: \{ startsWith: ACQUIREMOCK_SANDBOX_PREFIX \}/);
  assert.match(paymentRoutes, /idempotencyKey: `ibhms-sandbox-order-\$\{order\.id\}-\$\{randomUUID\(\)\}`/);
  assert.match(paymentRoutes, /prisma\.manualPayment\.create/);
});

test('FT-SBOX-SHOP-003 — Pending Sandbox Checkout', () => {
  assert.equal(sandbox._test.statusForScenario('pending'), 'pending');
  assert.match(sheetSource, /title: "Payment pending"/);
  assert.match(sheetSource, /Complete test payment/);
});

test('FT-SBOX-SHOP-004 — Leave and Reopen Pending Order', () => {
  assert.match(paymentScreen, /latestSandboxAttempt = sandboxAttempts\.find\(\(payment: any\) => payment\.status === "PENDING"\)/);
  assert.match(paymentScreen, /setSandboxCheckoutOpen\(true\)/);
});

test('FT-SBOX-SHOP-005 — Refresh Pending Shop Payment', () => {
  assert.match(paymentRoutes, /router\.get\('\/sandbox\/gcash\/order\/payment\/:paymentId'/);
  assert.match(shopScreen, /const refreshSandboxOrder = async/);
});

test('FT-SBOX-SHOP-006 — Cancel Pending Shop Payment', () => {
  assert.match(paymentRoutes, /router\.post\('\/sandbox\/gcash\/order\/payment\/:paymentId\/cancel'/);
  assert.match(shopScreen, /const cancelSandboxOrder = async/);
});

test('pending top-up and shop payments have explicit completion actions', () => {
  assert.match(paymentRoutes, /router\.post\('\/sandbox\/gcash\/:paymentId\/complete'/);
  assert.match(paymentRoutes, /router\.post\('\/sandbox\/gcash\/order\/payment\/:paymentId\/complete'/);
  assert.match(serviceSource, /match\[2\] === '\/complete'[\s\S]*completePayment/);
  assert.match(paymentScreen, /const completeSandbox = async/);
  assert.match(shopScreen, /const completeSandboxOrder = async/);
});
