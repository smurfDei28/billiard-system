const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const paymentSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'payment.routes.js'), 'utf8');
const memberOrderSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'member-order.routes.js'), 'utf8');
const mobileSource = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'screens', 'member', 'ManualPaymentScreen.tsx'), 'utf8');
const notificationsMobileSource = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'screens', 'member', 'NotificationsScreen.tsx'), 'utf8');
const shopMobileSource = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'screens', 'member', 'ShopScreen.tsx'), 'utf8');
const staffMobileSource = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'screens', 'staff', 'PaymentVerificationScreen.tsx'), 'utf8');
const staffOrdersSource = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'screens', 'staff', 'MemberOrdersScreen.tsx'), 'utf8');
const myOrdersSource = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'screens', 'member', 'MyOrdersScreen.tsx'), 'utf8');
const sandboxSheetSource = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'components', 'GCashSandboxSheet.tsx'), 'utf8');
const gcashSandboxServiceSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'gcashSandbox.service.js'), 'utf8');
const { summarizeRevenue } = require(path.join(__dirname, '..', 'src', 'utils', 'revenueReporting.js'));

test('built-in GCash sandbox is backend-only, gated, and preserves the mobile API contract', () => {
  assert.match(paymentSource, /gcashSandbox\.enabled/);
  assert.match(gcashSandboxServiceSource, /GCASH_SANDBOX_ENABLED/);
  assert.match(gcashSandboxServiceSource, /GCASH_SANDBOX_DEFAULT_SCENARIO/);
  assert.doesNotMatch(gcashSandboxServiceSource, /ACQUIREMOCK_BASE_URL/);
  assert.doesNotMatch(gcashSandboxServiceSource, /fetch\(/);
  assert.match(paymentSource, /amount: amount \* 100, currency: 'PHP', reference, scenario: req\.body\?\.scenario, idempotencyKey/);
  assert.match(paymentSource, /\/api\/payments\/gcash\/mock/);
  assert.match(paymentSource, /GET.*sandbox\/gcash\/config|router\.get\('\/sandbox\/gcash\/config'/s);
});

test('sandbox status uses the stored AcquireMock transaction ID and credits only one pending transition', () => {
  assert.match(paymentSource, /sandboxReference\(acquirePayment\.id\)/);
  assert.match(paymentSource, /encodeURIComponent\(transactionId\)/);
  assert.match(paymentSource, /updateMany\(\{ where: \{ id: payment\.id, status: 'PENDING' \}/);
  assert.match(paymentSource, /if \(claimed\.count\) \{[\s\S]*finalizeCreditTopup/);
  assert.match(paymentSource, /normalizedAcquirePayment\.status === 'failed' \|\| normalizedAcquirePayment\.status === 'cancelled'/);
  assert.match(paymentSource, /Sandbox payments are finalized only after IBHMS verifies AcquireMock status/);
});

test('sandbox shop payments use the server-authoritative order total and the shared order finalizer', () => {
  assert.match(paymentSource, /router\.post\('\/sandbox\/gcash\/order\/:orderId'/);
  assert.match(paymentSource, /amount: Math\.round\(order\.total \* 100\), currency: 'PHP'/);
  assert.match(paymentSource, /purpose: 'ORDER', orderId: order\.id, method: 'GCASH', amount: order\.total/);
  assert.match(paymentSource, /finalizePendingMemberOrder\(tx, \{ orderId: payment\.orderId, staffId: null \}\)/);
  assert.match(paymentSource, /router\.get\('\/sandbox\/gcash\/order\/payment\/:paymentId'/);
  assert.match(paymentSource, /router\.post\('\/sandbox\/gcash\/order\/payment\/:paymentId\/cancel'/);
  assert.match(paymentSource, /router\.post\('\/sandbox\/gcash\/order\/payment\/:paymentId\/complete'/);
});

test('legacy AcquireMock mockReference records refresh through the provider UUID and normalize known statuses', () => {
  assert.match(paymentSource, /gcash_mock_\(\[0-9a-f-\]\{36\}\)/i);
  assert.match(paymentSource, /const acquireMockId = \(referenceNo, notes = null\)/);
  assert.match(paymentSource, /normalizeAcquireMockPayment/);
  assert.match(paymentSource, /\['paid', 'failed', 'pending', 'cancelled'\]\.includes\(status\)/);
  assert.match(paymentSource, /acquireMockId\(payment\?\.referenceNo, payment\?\.notes\)/);
  assert.match(paymentSource, /\/api\/payments\/gcash\/mock\/\$\{encodeURIComponent\(transactionId\)\}/);
  assert.match(mobileSource, /gcash_mock_\[0-9a-f-\]\{36\}/i);
  assert.match(mobileSource, /normalizeSandboxStatus/);
  assert.match(mobileSource, /Could not retrieve this sandbox payment's provider status/);
});

test('an expired older pending mock is safely presented as cancelled while other unknown provider states still fail', () => {
  assert.match(gcashSandboxServiceSource, /statusFromNotes/);
  assert.match(paymentSource, /rawStatus === 'expired' \? 'cancelled' : rawStatus/);
  assert.match(paymentSource, /AcquireMock returned an unsupported payment status/);
  assert.match(mobileSource, /value === "cancelled" \? "Cancelled"/);
});

test('sandbox top-ups are excluded from cash-revenue reporting', () => {
  const revenue = summarizeRevenue({
    topups: [{ amount: 120, referenceNo: 'ACQUIREMOCK-test' }, { amount: 80, referenceNo: 'MANUAL-123' }],
  });
  assert.equal(revenue.creditTopups, 80);
  assert.equal(revenue.cashRevenue, 80);
});

test('new pending GCash sandbox Shop notifications use a pending label without changing their related-item route', () => {
  assert.match(memberOrderSource, /const sandboxPending = !credits && String\(req\.body\.paymentMethod \|\| ''\)\.toUpperCase\(\) === 'GCASH'/);
  assert.match(memberOrderSource, /sandboxPending \? \{ paymentStatus: 'PENDING', sandbox: 'ACQUIREMOCK' \} : \{\}/);
  assert.match(memberOrderSource, /title: credits \? 'Order paid' : 'Order received'/);
  assert.match(memberOrderSource, /Your order is waiting for payment confirmation\./);
  assert.match(memberOrderSource, /actionRoute: 'Payments'/);
  assert.match(paymentSource, /title: 'Sandbox order payment successful'/);
  assert.match(notificationsMobileSource, /data\.sandbox === 'ACQUIREMOCK' && data\.paymentStatus === 'PENDING'/);
  assert.match(notificationsMobileSource, /return 'PAYMENT PENDING'/);
  assert.match(notificationsMobileSource, /navigation\.navigate\('Payments', \{ orderId: order\.id \}\)/);
});

test('member UI exposes explicit sandbox outcomes and refreshes through IBHMS', () => {
  assert.match(mobileSource, /sandboxEnabled/);
  assert.match(mobileSource, /GCash Sandbox \/ Mock/);
  assert.match(mobileSource, /Development testing only\. No real GCash transaction will occur\./);
  assert.match(mobileSource, /\/api\/payments\/sandbox\/gcash\//);
  assert.match(sandboxSheetSource, /Check payment status/);
  assert.match(sandboxSheetSource, /Complete test payment/);
  assert.match(sandboxSheetSource, /stays pending until you complete or cancel it/);
  assert.doesNotMatch(sandboxSheetSource, /setTimeout\(onRefresh/);
  assert.match(sandboxSheetSource, /Try again/);
  assert.match(sandboxSheetSource, /NO REAL MONEY/);
  assert.match(sandboxSheetSource, /Success/);
  assert.match(sandboxSheetSource, /Failed/);
  assert.match(sandboxSheetSource, /Pending/);
  assert.match(sandboxSheetSource, /Cancelled/);
  assert.match(mobileSource, /scenario: sandboxScenario/);
  assert.match(shopMobileSource, /scenario: sandboxScenario/);
  assert.doesNotMatch(mobileSource, /\["GCASH", "MAYA"\]\.includes\(item\.method\)/);
});

test('a completed credit top-up receipt is cleared before the next checkout', () => {
  assert.match(mobileSource, /const closeSandboxCheckout = \(\) =>/);
  assert.match(mobileSource, /\(isCreditTopUp \|\| isOrderPayment\) && status && status !== "pending"/);
  assert.match(mobileSource, /setSandboxPayment\(null\)/);
  assert.match(mobileSource, /onClose=\{closeSandboxCheckout\}/);
});

test('shared payment screen sends sandbox orders through the persisted-order endpoint before top-up validation', () => {
  const sandboxSubmit = mobileSource.slice(mobileSource.indexOf('const submitSandbox'), mobileSource.indexOf('const refreshSandbox'));
  assert.match(sandboxSubmit, /if \(isOrderPayment\) \{/);
  assert.match(sandboxSubmit, /\/api\/payments\/sandbox\/gcash\/order\/\$\{encodeURIComponent\(orderId\)\}/);
  assert.ok(sandboxSubmit.indexOf('if (isOrderPayment)') < sandboxSubmit.indexOf('Invalid credits'));
  assert.match(mobileSource, /\/sandbox\/gcash\/order\/payment\/\$\{encodeURIComponent\(sandboxPayment\.payment\.id\)\}/);
  assert.match(mobileSource, /order\.paymentMethod === "GCASH" && sandboxConfigRes\.data\?\.enabled/);
});

test('reopening a Shop order restores its newest AcquireMock attempt instead of offering a duplicate payment', () => {
  assert.match(memberOrderSource, /manualPayments: \{ select: \{ id: true, status: true, method: true, referenceNo: true, notes: true, createdAt: true \}, orderBy: \{ createdAt: 'desc' \} \}/);
  assert.match(mobileSource, /const sandboxAttempts = order\.manualPayments\?\.filter\(isSandboxOrderAttempt\) \|\| \[\]/);
  assert.match(mobileSource, /const latestSandboxAttempt = sandboxAttempts\.find\(\(payment: any\) => payment\.status === "PENDING"\) \|\| sandboxAttempts\[0\]/);
  assert.match(mobileSource, /\/api\/payments\/sandbox\/gcash\/order\/payment\/\$\{encodeURIComponent\(latestSandboxAttempt\.id\)\}/);
  assert.match(mobileSource, /sandboxPaymentOrderId === orderId[\s\S]*normalizeSandboxStatus\(sandboxPayment\?\.sandbox\?\.status\) === "pending"/);
  assert.match(mobileSource, /!hasRestoredSandboxOrderPayment && <TouchableOpacity/);
  assert.match(mobileSource, /isSandbox \? "Payment details" : `3\. \$\{isCash \? "Cash payment details" : "Payment proof"\}`/);
});

test('completing one pending Shop order cannot hide payment for the next order', () => {
  assert.match(mobileSource, /const selectPendingShopOrder = \(order: any\) =>/);
  assert.match(mobileSource, /if \(order\.id !== sandboxPaymentOrderId\) \{[\s\S]*setSandboxPayment\(null\)/);
  assert.match(mobileSource, /onPress=\{\(\) => selectPendingShopOrder\(order\)\}/);
  assert.match(mobileSource, /status === "paid" \|\| data\.order\.paymentStatus !== "PENDING"[\s\S]*previous\.filter\(\(order\) => order\.id !== data\.order\.id\)/);
  assert.match(mobileSource, /\(isCreditTopUp \|\| isOrderPayment\) && status && status !== "pending"/);
});

test('My Orders distinguishes the pending order from its current AcquireMock payment attempt', () => {
  assert.match(myOrdersSource, /const sandboxAttempts = \(order\.manualPayments \|\| \[\]\)\.filter\(isAcquireMockSandboxAttempt\)/);
  assert.match(myOrdersSource, /sandboxAttempts\.find\(\(payment: any\) => payment\.status === 'PENDING'\) \|\| sandboxAttempts\[0\]/);
  assert.match(myOrdersSource, /`\$\{order\.paymentStatus\} · PAYMENT \$\{providerStatus\}`/);
  assert.match(myOrdersSource, /providerStatus === 'FAILED' \|\| providerStatus === 'CANCELLED'[\s\S]*?'Retry Payment'/);
  assert.match(myOrdersSource, /providerStatus === 'PENDING'[\s\S]*?'Resume Payment'/);
  assert.match(myOrdersSource, /navigation\.navigate\('Payments', \{ orderId: order\.id \}\)/);
});

test('member shop exposes Cash, Credits, and the provider-controlled GCash sandbox without QR proof navigation', () => {
  assert.match(shopMobileSource, /\["CASH", "CREDITS", \.\.\.\(sandboxEnabled \? \["GCASH"\] : \[\]\)\]/);
  assert.match(shopMobileSource, /GCash Sandbox \/ Mock/);
  assert.match(shopMobileSource, /\/api\/payments\/sandbox\/gcash\/order\//);
  assert.match(shopMobileSource, /GCashSandboxSheet/);
  assert.match(sandboxSheetSource, /Check payment status/);
  assert.match(sandboxSheetSource, /Try again/);
  assert.doesNotMatch(shopMobileSource, /\["CASH", "CREDITS", "GCASH", "MAYA"\]/);
  assert.doesNotMatch(shopMobileSource, /Submit your payment proof/);
  assert.doesNotMatch(shopMobileSource, /navigation\.navigate\("Payments", \{ orderId/);
});

test('credit top-up exposes one fixed sandbox method and never flashes the retired manual proof form', () => {
  assert.match(mobileSource, /const usesSandboxCheckout = isCreditTopUp \|\|/);
  assert.match(mobileSource, /if \(requestedPurpose === "CREDIT_TOPUP"\) \{[\s\S]*setMethod\(sandboxIsEnabled \? \{ method: "ACQUIREMOCK_GCASH_SANDBOX"/);
  assert.match(mobileSource, /<View style=\{s\.fixedSandboxMethod\}>/);
  assert.doesNotMatch(mobileSource, /onPress=\{\(\) => setMethod\(\{ method: "ACQUIREMOCK_GCASH_SANDBOX"/);
  assert.match(mobileSource, /!isCreditTopUp && !isCash && \(/);
  assert.match(mobileSource, /\(!isCreditTopUp \|\| isSandbox\) && !hasRestoredSandboxOrderPayment/);
});

test('staff and admin show sandbox records as transaction history without manual controls', () => {
  assert.match(staffMobileSource, /isAcquireMockSandbox/);
  assert.match(staffMobileSource, /AcquireMock Sandbox/);
  assert.match(staffMobileSource, /Transaction History/);
  assert.match(staffMobileSource, /View member top-up and payment transactions/);
  assert.match(staffMobileSource, /Provider-controlled/);
  assert.match(staffMobileSource, /canReviewManualPayment = payment\.status === 'PENDING' && !sandbox/);
  assert.match(staffMobileSource, /reviewManualPayment\(payment\.id, 'APPROVE'\)/);
  assert.doesNotMatch(staffMobileSource, /QR payment settings/);
  assert.doesNotMatch(staffMobileSource, /methods\/manage/);
  assert.doesNotMatch(staffMobileSource, /\['PENDING', 'APPROVED', 'REJECTED'\]/);
  assert.match(staffOrdersSource, /Awaiting payment confirmation/);
});
