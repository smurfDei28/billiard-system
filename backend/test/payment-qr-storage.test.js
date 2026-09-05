const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const paymentRouter = require('../src/routes/payment.routes');

test('persists a durable QR URL on both upsert paths and preserves it for text-only saves', async () => {
  const calls = [];
  const db = { paymentMethodConfig: { upsert: async (args) => { calls.push(args); return args.update; } } };
  const details = {
    method: 'GCASH', businessName: 'Saturday Nights', accountName: 'Admin',
    accountNumber: '09170000000', instructions: 'Scan to pay', isEnabled: true,
  };
  const storedUrl = 'https://project.supabase.co/storage/v1/object/public/payment-qr/gcash/current.png';

  await paymentRouter._qrStorage.savePaymentMethodConfig(details, storedUrl, db);
  await paymentRouter._qrStorage.savePaymentMethodConfig({ ...details, accountName: 'Updated Admin' }, undefined, db);

  assert.equal(calls[0].create.qrCodeUrl, storedUrl);
  assert.equal(calls[0].update.qrCodeUrl, storedUrl);
  assert.equal('qrCodeUrl' in calls[1].create, false);
  assert.equal('qrCodeUrl' in calls[1].update, false);
  assert.equal(calls[1].update.accountName, 'Updated Admin');
});

test('stores a GCash QR in the configured public Storage bucket and can remove its replacement', async () => {
  const configuredBucket = process.env.PAYMENT_QR_STORAGE_BUCKET || 'payment-qr';
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_KEY;
  const temporaryFile = path.join(os.tmpdir(), `payment-qr-${Date.now()}.png`);
  const requests = [];

  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  fs.writeFileSync(temporaryFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200 };
  };

  try {
    const uploaded = await paymentRouter._qrStorage.uploadQrToStorage('GCASH', {
      path: temporaryFile,
      mimetype: 'image/png',
    });
    assert.match(uploaded.publicUrl, new RegExp(`^https://project\\.supabase\\.co/storage/v1/object/public/${configuredBucket}/gcash/.+\\.png$`));
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.headers['Content-Type'], 'image/png');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer test-service-key');

    await paymentRouter._qrStorage.removeStoredQr(uploaded.publicUrl);
    assert.equal(requests[1].options.method, 'DELETE');
    assert.match(requests[1].url, new RegExp(`/storage/v1/object/${configuredBucket}/gcash/`));
  } finally {
    fs.unlinkSync(temporaryFile);
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = originalKey;
  }
});
