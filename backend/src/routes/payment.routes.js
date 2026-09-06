const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { settlePendingCancellationFees } = require('../utils/cancellationFees');
const { finalizePendingMemberOrder } = require('../services/memberOrder.service');
const gcashSandbox = require('../services/gcashSandbox.service');

const router = express.Router();
const QR_METHODS = ['GCASH', 'MAYA'];
const PAYMENT_METHODS = [...QR_METHODS, 'CASH'];
const ACQUIREMOCK_SANDBOX_PREFIX = 'ACQUIREMOCK-';
const UPLOAD_ROOT = path.join(__dirname, '../../uploads');
const receiptDirectory = path.join(UPLOAD_ROOT, 'payment-proofs');
const qrDirectory = path.join(UPLOAD_ROOT, 'payment-qr');
const QR_STORAGE_BUCKET = process.env.PAYMENT_QR_STORAGE_BUCKET || 'payment-qr';
const QR_IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

[receiptDirectory, qrDirectory].forEach((directory) => fs.mkdirSync(directory, { recursive: true }));

const imageUpload = (directory) => multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, directory),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) return cb(new Error('Only image receipt files are allowed.'));
    cb(null, true);
  },
});

const receiptUpload = imageUpload(receiptDirectory);
const qrUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, qrDirectory),
    filename: (_req, _file, cb) => cb(null, `${Date.now()}-${randomUUID()}.upload`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!QR_IMAGE_EXTENSIONS[file.mimetype]) return cb(new Error('QR_IMAGE_TYPE_INVALID'));
    cb(null, true);
  },
});

const validQrMethod = (method) => QR_METHODS.includes(String(method || '').toUpperCase());
const validPaymentMethod = (method) => PAYMENT_METHODS.includes(String(method || '').toUpperCase());
const logQrRawRequest = (req, _res, next) => {
  console.log('[QR Upload] raw request entered', {
    method: req.method,
    path: req.originalUrl,
    contentType: req.get('content-type') || null,
    contentLength: req.get('content-length') || null,
  });
  next();
};
const publicUrl = (req, value) => {
  if (!value || /^https?:\/\//i.test(value)) return value;
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}${value.startsWith('/') ? value : `/${value}`}`;
};
const publicMethodConfig = (req, config) => config && ({ ...config, qrCodeUrl: publicUrl(req, config.qrCodeUrl) });
const paymentInclude = {
  user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  order: { select: { id: true, receiptNumber: true } },
};

const acquireMockEnabled = gcashSandbox.enabled;
const sandboxReference = (transactionId) => `${ACQUIREMOCK_SANDBOX_PREFIX}${transactionId}`;
const acquireMockId = (referenceNo, notes = null) => {
  const reference = String(referenceNo || '').trim();
  const prefixedReference = reference.startsWith(ACQUIREMOCK_SANDBOX_PREFIX)
    ? reference.slice(ACQUIREMOCK_SANDBOX_PREFIX.length) : null;
  // Older IBHMS records stored AcquireMock's mockReference (gcash_mock_<UUID>) rather than its API id.
  const legacyMockReference = [prefixedReference, reference, String(notes || '')]
    .filter(Boolean)
    .join(' ')
    .match(/gcash_mock_([0-9a-f-]{36})/i)?.[1];
  return legacyMockReference || prefixedReference || null;
};
const sandboxNotes = (payment) => `ACQUIREMOCK SANDBOX | scenario=${payment.scenario} | status=${payment.status}`;
const normalizeAcquireMockPayment = (payment) => {
  const rawStatus = String(payment?.status || '').toLowerCase();
  // AcquireMock's generic expiry worker can expire an older pending mock payment.
  // IBHMS represents that safe, non-payable terminal outcome as its existing cancelled state.
  const status = rawStatus === 'expired' ? 'cancelled' : rawStatus;
  if (!['paid', 'failed', 'pending', 'cancelled'].includes(status)) {
    throw Object.assign(new Error('AcquireMock returned an unsupported payment status.'), { status: 502 });
  }
  return { ...payment, status, rawStatus };
};

const acquireMockRequest = gcashSandbox.request;

const finalizeCreditTopup = async (tx, payment, { description, staffId = null }) => {
  const membership = await tx.membership.findUnique({ where: { userId: payment.userId } });
  if (!membership) throw Object.assign(new Error('Member account is missing.'), { status: 400 });
  const updatedMembership = await tx.membership.update({ where: { userId: payment.userId }, data: { creditBalance: { increment: payment.amount } } });
  await tx.creditTransaction.create({ data: {
    userId: payment.userId, type: 'TOPUP', amount: payment.amount, balanceBefore: membership.creditBalance,
    balanceAfter: updatedMembership.creditBalance, description, paymentMethod: payment.method,
    referenceNo: payment.referenceNo, staffId,
  } });
  const settlement = await settlePendingCancellationFees(tx, payment.userId, staffId);
  return { balance: settlement.balance ?? updatedMembership.creditBalance, settlement };
};

const synchronizeSandboxPayment = async ({ paymentId, userId, acquirePayment }) => {
  const normalizedAcquirePayment = normalizeAcquireMockPayment(acquirePayment);
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.manualPayment.findFirst({ where: { id: paymentId, userId, purpose: 'CREDIT_TOPUP', method: 'GCASH' } });
    if (!payment || !acquireMockId(payment.referenceNo, payment.notes)) throw Object.assign(new Error('Sandbox payment was not found.'), { status: 404 });
    const updateData = { notes: sandboxNotes(normalizedAcquirePayment), reviewedAt: normalizedAcquirePayment.status === 'pending' ? null : new Date() };

    if (normalizedAcquirePayment.status === 'paid') {
      const claimed = await tx.manualPayment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { ...updateData, status: 'APPROVED', reviewerId: null, reviewerRemarks: 'Approved by AcquireMock sandbox.' } });
      if (claimed.count) {
        const finalized = await finalizeCreditTopup(tx, payment, { description: 'AcquireMock sandbox GCash top-up' });
        await tx.notification.create({ data: {
          userId: payment.userId, type: 'TOPUP_SUCCESS', title: 'Sandbox top-up successful',
          message: `${payment.amount.toFixed(0)} test credits were added. New balance: ${finalized.balance.toFixed(0)} credits.`,
          data: { paymentId: payment.id, amount: payment.amount, balance: finalized.balance, paymentMethod: 'GCASH', sandbox: 'ACQUIREMOCK' }, actionRoute: 'Payments',
        } });
      }
    } else if (normalizedAcquirePayment.status === 'failed' || normalizedAcquirePayment.status === 'cancelled') {
      await tx.manualPayment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { ...updateData, status: 'REJECTED', reviewerId: null, reviewerRemarks: `AcquireMock sandbox payment ${normalizedAcquirePayment.status}.` } });
    } else {
      await tx.manualPayment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: updateData });
    }
    return tx.manualPayment.findUnique({ where: { id: payment.id } });
  }, { maxWait: 10000, timeout: 20000 });
  return { payment: result, sandbox: normalizedAcquirePayment };
};

const synchronizeSandboxOrderPayment = async ({ paymentId, userId, acquirePayment }) => {
  const normalizedAcquirePayment = normalizeAcquireMockPayment(acquirePayment);
  return prisma.$transaction(async (tx) => {
    const payment = await tx.manualPayment.findFirst({ where: { id: paymentId, userId, purpose: 'ORDER', method: 'GCASH' } });
    if (!payment || !payment.orderId || !acquireMockId(payment.referenceNo, payment.notes)) throw Object.assign(new Error('Sandbox order payment was not found.'), { status: 404 });
    const updateData = { notes: sandboxNotes(normalizedAcquirePayment), reviewedAt: normalizedAcquirePayment.status === 'pending' ? null : new Date() };
    let finalizedOrder = null;

    if (normalizedAcquirePayment.status === 'paid') {
      const claimed = await tx.manualPayment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { ...updateData, status: 'APPROVED', reviewerId: null, reviewerRemarks: 'Approved by AcquireMock sandbox.' } });
      if (claimed.count) {
        const finalized = await finalizePendingMemberOrder(tx, { orderId: payment.orderId, staffId: null });
        finalizedOrder = finalized.order;
        await tx.notification.create({ data: {
          userId: payment.userId, type: 'PAYMENT_RECEIVED', title: 'Sandbox order payment successful',
          message: `Your order ${finalized.order.receiptNumber} has been paid and accepted for preparation.`,
          data: { paymentId: payment.id, orderId: finalized.order.id, paymentMethod: 'GCASH', sandbox: 'ACQUIREMOCK' }, actionRoute: 'Orders',
        } });
      }
    } else if (normalizedAcquirePayment.status === 'failed' || normalizedAcquirePayment.status === 'cancelled') {
      await tx.manualPayment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { ...updateData, status: 'REJECTED', reviewerId: null, reviewerRemarks: `AcquireMock sandbox payment ${normalizedAcquirePayment.status}.` } });
    } else {
      await tx.manualPayment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: updateData });
    }

    const [persistedPayment, order] = await Promise.all([
      tx.manualPayment.findUnique({ where: { id: payment.id }, include: paymentInclude }),
      finalizedOrder ? Promise.resolve(finalizedOrder) : tx.order.findUnique({ where: { id: payment.orderId }, include: { items: { include: { product: true } } } }),
    ]);
    return { payment: persistedPayment, sandbox: normalizedAcquirePayment, order };
  }, { maxWait: 10000, timeout: 20000 });
};

const logPaymentReview = (step, context) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Payment Review] ${step}`, context);
  }
};

const paymentMethodDetails = ({ businessName, accountName, accountNumber, instructions, isEnabled }) => ({
  businessName: String(businessName || '').trim(),
  accountName: String(accountName || '').trim(),
  accountNumber: String(accountNumber || '').trim() || null,
  instructions: String(instructions || '').trim() || null,
  isEnabled: Boolean(isEnabled),
});

const isStoredQrUrl = (value) => {
  const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const prefix = `${baseUrl}/storage/v1/object/public/${encodeURIComponent(QR_STORAGE_BUCKET)}/`;
  return typeof value === 'string' && value.startsWith(prefix);
};

const savePaymentMethodConfig = ({ method, ...details }, qrCodeUrl, db = prisma) => {
  const qrData = qrCodeUrl ? { qrCodeUrl } : {};
  return db.paymentMethodConfig.upsert({
    where: { method },
    create: { method, ...paymentMethodDetails(details), ...qrData },
    update: { ...paymentMethodDetails(details), ...qrData },
  });
};

const removeLocalUpload = (file) => {
  if (file?.path) fs.unlink(file.path, () => {});
};

const qrStorageSettings = () => {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) {
    throw Object.assign(new Error('QR image storage is not configured.'), { status: 503 });
  }
  return { url, serviceKey };
};

const storageObjectUrl = (baseUrl, bucket, objectKey) => `${baseUrl}/storage/v1/object/${[bucket, ...objectKey.split('/')].map(encodeURIComponent).join('/')}`;
const publicStorageObjectUrl = (baseUrl, bucket, objectKey) => `${baseUrl}/storage/v1/object/public/${[bucket, ...objectKey.split('/')].map(encodeURIComponent).join('/')}`;

const uploadQrToStorage = async (method, file) => {
  const { url, serviceKey } = qrStorageSettings();
  const extension = QR_IMAGE_EXTENSIONS[file.mimetype];
  const objectKey = `${method.toLowerCase()}/${Date.now()}-${randomUUID()}.${extension}`;
  const body = await fs.promises.readFile(file.path);
  const response = await fetch(storageObjectUrl(url, QR_STORAGE_BUCKET, objectKey), {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': file.mimetype,
      'Cache-Control': '3600',
      'x-upsert': 'false',
    },
    body,
  });
  if (!response.ok) {
    console.error('[Manual Payment] QR storage upload failed', { status: response.status, method });
    throw Object.assign(new Error('QR image storage could not accept the upload.'), { status: 502 });
  }
  return { objectKey, publicUrl: publicStorageObjectUrl(url, QR_STORAGE_BUCKET, objectKey) };
};

const removeStoredQr = async (url) => {
  const settings = qrStorageSettings();
  const publicPrefix = `${settings.url}/storage/v1/object/public/${encodeURIComponent(QR_STORAGE_BUCKET)}/`;
  if (!url?.startsWith(publicPrefix)) return;
  const objectKey = decodeURIComponent(url.slice(publicPrefix.length));
  const response = await fetch(storageObjectUrl(settings.url, QR_STORAGE_BUCKET, objectKey), {
    method: 'DELETE',
    headers: { apikey: settings.serviceKey, Authorization: `Bearer ${settings.serviceKey}` },
  });
  if (!response.ok) console.error('[Manual Payment] Previous QR cleanup failed', { status: response.status });
};

const notifyStaff = async (data) => {
  const reviewers = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'STAFF'] } }, select: { id: true } });
  if (reviewers.length) await prisma.notification.createMany({ data: reviewers.map((staff) => ({ ...data, userId: staff.id })) });
};

const playerPaymentOnly = (req, res, next) => {
  if (req.user?.role !== 'MEMBER') {
    return res.status(403).json({ error: 'Payment submissions are available only for Player accounts.', code: 'PAYMENT_SUBMISSION_PLAYER_ONLY' });
  }
  next();
};

// Player-facing configuration; never exposes a secret or gateway credential.
router.get('/methods', authenticate, async (req, res) => {
  try {
    const methods = await prisma.paymentMethodConfig.findMany({
      where: { method: { in: QR_METHODS }, isEnabled: true },
      orderBy: { method: 'asc' },
    });
    res.json([...methods.map((method) => publicMethodConfig(req, method)), {
      method: 'CASH', businessName: 'Saturday Nights Billiard', accountName: 'Pay at the counter', accountNumber: null,
      qrCodeUrl: null, instructions: 'Present this request and pay the exact amount to staff. Your credits are added after staff verification.', isEnabled: true,
    }]);
  } catch (err) {
    console.error('[Manual Payment] Could not load QR methods', err);
    res.status(500).json({ error: 'Could not load payment methods.' });
  }
});

router.get('/mine', authenticate, async (req, res) => {
  try {
    const payments = await prisma.manualPayment.findMany({
      where: { userId: req.user.id }, include: paymentInclude, orderBy: { createdAt: 'desc' }, take: 50,
    });
    res.json(payments);
  } catch (err) {
    console.error('[Manual Payment] Could not load member payment history', err);
    res.status(500).json({ error: 'Could not load payment history.' });
  }
});

router.get('/sandbox/gcash/config', authenticate, playerPaymentOnly, (_req, res) => {
  res.json({ enabled: acquireMockEnabled() });
});

router.post('/sandbox/gcash', authenticate, playerPaymentOnly, async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'Enter a positive whole-number credit amount.' });
  try {
    const reference = `IBHMS-SANDBOX-${randomUUID()}`;
    const acquirePayment = await acquireMockRequest('/api/payments/gcash/mock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amount * 100, currency: 'PHP', reference, scenario: req.body?.scenario, idempotencyKey: `ibhms-sandbox-${req.user.id}-${randomUUID()}` }),
    });
    if (!acquirePayment?.id || !['paid', 'failed', 'pending', 'cancelled'].includes(acquirePayment.status)) throw Object.assign(new Error('AcquireMock returned an invalid payment response.'), { status: 502 });
    const payment = await prisma.manualPayment.create({ data: {
      userId: req.user.id, purpose: 'CREDIT_TOPUP', method: 'GCASH', amount,
      referenceNo: sandboxReference(acquirePayment.id), notes: sandboxNotes(acquirePayment),
    } });
    const synchronized = await synchronizeSandboxPayment({ paymentId: payment.id, userId: req.user.id, acquirePayment });
    res.status(201).json(synchronized);
  } catch (err) {
    console.error('[AcquireMock Sandbox] Creation failed', { message: err.message, status: err.status });
    res.status(err.status || 502).json({ error: err.status ? err.message : 'Could not create sandbox payment.' });
  }
});

router.post('/sandbox/gcash/order/:orderId', authenticate, playerPaymentOnly, async (req, res) => {
  try {
    const order = await prisma.order.findFirst({ where: { id: req.params.orderId, userId: req.user.id, source: 'MEMBER_SHOP', paymentMethod: 'GCASH', paymentStatus: 'PENDING' } });
    if (!order) return res.status(404).json({ error: 'Pending GCash sandbox order was not found.' });

    let payment = await prisma.manualPayment.findFirst({ where: { orderId: order.id, userId: req.user.id, purpose: 'ORDER', method: 'GCASH', status: 'PENDING', referenceNo: { startsWith: ACQUIREMOCK_SANDBOX_PREFIX } } });
    if (payment) {
      const transactionId = acquireMockId(payment.referenceNo, payment.notes);
      const acquirePayment = await acquireMockRequest(`/api/payments/gcash/mock/${encodeURIComponent(transactionId)}`);
      return res.json(await synchronizeSandboxOrderPayment({ paymentId: payment.id, userId: req.user.id, acquirePayment }));
    }

    const acquirePayment = await acquireMockRequest('/api/payments/gcash/mock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Math.round(order.total * 100), currency: 'PHP', reference: `IBHMS-SHOP-${order.id}`, scenario: req.body?.scenario, idempotencyKey: `ibhms-sandbox-order-${order.id}-${randomUUID()}` }),
    });
    if (!acquirePayment?.id || !['paid', 'failed', 'pending', 'cancelled'].includes(acquirePayment.status)) throw Object.assign(new Error('AcquireMock returned an invalid payment response.'), { status: 502 });
    try {
      payment = await prisma.manualPayment.create({ data: {
        userId: req.user.id, purpose: 'ORDER', orderId: order.id, method: 'GCASH', amount: order.total,
        referenceNo: sandboxReference(acquirePayment.id), notes: sandboxNotes(acquirePayment),
      } });
    } catch (err) {
      if (err.code !== 'P2002') throw err;
      payment = await prisma.manualPayment.findFirst({ where: { orderId: order.id, userId: req.user.id, purpose: 'ORDER', method: 'GCASH', referenceNo: sandboxReference(acquirePayment.id) } });
      if (!payment) throw err;
    }
    res.status(201).json(await synchronizeSandboxOrderPayment({ paymentId: payment.id, userId: req.user.id, acquirePayment }));
  } catch (err) {
    console.error('[AcquireMock Sandbox] Order creation failed', { orderId: req.params.orderId, message: err.message, status: err.status });
    res.status(err.status || 502).json({ error: err.status ? err.message : 'Could not create sandbox order payment.' });
  }
});

router.get('/sandbox/gcash/order/payment/:paymentId', authenticate, playerPaymentOnly, async (req, res) => {
  try {
    const payment = await prisma.manualPayment.findFirst({ where: { id: req.params.paymentId, userId: req.user.id, purpose: 'ORDER', method: 'GCASH' } });
    const transactionId = acquireMockId(payment?.referenceNo, payment?.notes);
    if (!transactionId) return res.status(404).json({ error: 'Sandbox order payment was not found.' });
    const acquirePayment = await acquireMockRequest(`/api/payments/gcash/mock/${encodeURIComponent(transactionId)}`);
    res.json(await synchronizeSandboxOrderPayment({ paymentId: payment.id, userId: req.user.id, acquirePayment }));
  } catch (err) {
    console.error('[AcquireMock Sandbox] Order status check failed', { message: err.message, status: err.status });
    res.status(err.status || 502).json({ error: err.status ? err.message : 'Could not refresh sandbox order payment status.' });
  }
});

router.post('/sandbox/gcash/order/payment/:paymentId/cancel', authenticate, playerPaymentOnly, async (req, res) => {
  try {
    const payment = await prisma.manualPayment.findFirst({ where: { id: req.params.paymentId, userId: req.user.id, purpose: 'ORDER', method: 'GCASH', status: 'PENDING' } });
    const transactionId = acquireMockId(payment?.referenceNo, payment?.notes);
    if (!transactionId) return res.status(404).json({ error: 'Pending sandbox order payment was not found.' });
    const acquirePayment = await acquireMockRequest(`/api/payments/gcash/mock/${encodeURIComponent(transactionId)}/cancel`, { method: 'POST' });
    res.json(await synchronizeSandboxOrderPayment({ paymentId: payment.id, userId: req.user.id, acquirePayment }));
  } catch (err) {
    console.error('[AcquireMock Sandbox] Order cancellation failed', { message: err.message, status: err.status });
    res.status(err.status || 502).json({ error: err.status ? err.message : 'Could not cancel sandbox order payment.' });
  }
});

router.get('/sandbox/gcash/:paymentId', authenticate, playerPaymentOnly, async (req, res) => {
  try {
    const payment = await prisma.manualPayment.findFirst({ where: { id: req.params.paymentId, userId: req.user.id, purpose: 'CREDIT_TOPUP', method: 'GCASH' } });
    const transactionId = acquireMockId(payment?.referenceNo, payment?.notes);
    if (!transactionId) return res.status(404).json({ error: 'Sandbox payment was not found.' });
    const acquirePayment = await acquireMockRequest(`/api/payments/gcash/mock/${encodeURIComponent(transactionId)}`);
    res.json(await synchronizeSandboxPayment({ paymentId: payment.id, userId: req.user.id, acquirePayment }));
  } catch (err) {
    console.error('[AcquireMock Sandbox] Status check failed', { message: err.message, status: err.status });
    res.status(err.status || 502).json({ error: err.status ? err.message : 'Could not refresh sandbox payment status.' });
  }
});

router.post('/sandbox/gcash/:paymentId/cancel', authenticate, playerPaymentOnly, async (req, res) => {
  try {
    const payment = await prisma.manualPayment.findFirst({ where: { id: req.params.paymentId, userId: req.user.id, purpose: 'CREDIT_TOPUP', method: 'GCASH', status: 'PENDING' } });
    const transactionId = acquireMockId(payment?.referenceNo, payment?.notes);
    if (!transactionId) return res.status(404).json({ error: 'Pending sandbox payment was not found.' });
    const acquirePayment = await acquireMockRequest(`/api/payments/gcash/mock/${encodeURIComponent(transactionId)}/cancel`, { method: 'POST' });
    res.json(await synchronizeSandboxPayment({ paymentId: payment.id, userId: req.user.id, acquirePayment }));
  } catch (err) {
    console.error('[AcquireMock Sandbox] Cancellation failed', { message: err.message, status: err.status });
    res.status(err.status || 502).json({ error: err.status ? err.message : 'Could not cancel sandbox payment.' });
  }
});

router.get('/tournament-entries', authenticate, playerPaymentOnly, async (req, res) => {
  try {
    const entries = await prisma.tournamentEntry.findMany({
      where: { userId: req.user.id, status: { in: ['PENDING_PAYMENT', 'PENDING_APPROVAL'] } },
      include: { tournament: { select: { id: true, name: true, entryFee: true, startDate: true } } },
      orderBy: { registeredAt: 'desc' },
    });
    res.json(entries);
  } catch (err) {
    console.error('[Manual Payment] Could not load tournament entries', err);
    res.status(500).json({ error: 'Could not load pending tournament registrations.' });
  }
});

router.post('/submit', authenticate, playerPaymentOnly, receiptUpload.single('receipt'), async (req, res) => {
  const { purpose, method, amount, referenceNo, notes, tournamentEntryId, orderId } = req.body;
  const parsedAmount = Number(amount);
  const normalizedMethod = String(method || '').toUpperCase();

  if (!['CREDIT_TOPUP', 'TOURNAMENT_ENTRY', 'ORDER'].includes(purpose)) {
    return res.status(400).json({ error: 'Choose a valid payment purpose.' });
  }
  if (!validPaymentMethod(normalizedMethod)) return res.status(400).json({ error: 'Choose GCash, Maya, or Cash.' });
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ error: 'Enter a valid payment amount.' });
  if (purpose === 'CREDIT_TOPUP' && !Number.isInteger(parsedAmount)) return res.status(400).json({ error: 'Credit top-ups must use a whole number of credits.' });
  if (purpose === 'CREDIT_TOPUP' && !QR_METHODS.includes(normalizedMethod)) return res.status(400).json({ error: 'Credit top-ups are available through GCash or Maya only.' });
  if (normalizedMethod !== 'CASH' && !String(referenceNo || '').trim()) return res.status(400).json({ error: 'A transaction reference number is required.' });
  if (normalizedMethod !== 'CASH' && !req.file) return res.status(400).json({ error: 'Upload a screenshot of your payment receipt.' });

  try {
    if (normalizedMethod !== 'CASH') {
      const config = await prisma.paymentMethodConfig.findUnique({ where: { method: normalizedMethod } });
      if (!config?.isEnabled) return res.status(400).json({ error: `${normalizedMethod === 'GCASH' ? 'GCash' : 'Maya'} payments are not available right now.` });
    }
    if (normalizedMethod === 'CASH') {
      const recentDuplicate = await prisma.manualPayment.findFirst({
        where: { userId: req.user.id, purpose, method: 'CASH', amount: parsedAmount, status: 'PENDING', createdAt: { gte: new Date(Date.now() - 60 * 1000) } },
      });
      if (recentDuplicate) return res.status(409).json({ error: 'An identical cash payment request was just submitted. Please wait for staff verification.' });
    }

    if (purpose === 'TOURNAMENT_ENTRY') {
      if (!tournamentEntryId) return res.status(400).json({ error: 'Select the tournament registration this payment is for.' });
      const entry = await prisma.tournamentEntry.findFirst({
        where: { id: tournamentEntryId, userId: req.user.id }, include: { tournament: true },
      });
      if (!entry) return res.status(404).json({ error: 'Tournament registration not found.' });
      if (entry.status === 'APPROVED') return res.status(409).json({ error: 'This tournament registration has already been approved.' });
      const existingProof = await prisma.manualPayment.findFirst({ where: { tournamentEntryId, status: 'PENDING' } });
      if (existingProof) return res.status(409).json({ error: 'A payment proof for this registration is already awaiting review.' });
      if (Math.abs(entry.tournament.entryFee - parsedAmount) > 0.01) {
        return res.status(400).json({ error: `The tournament entry fee is PHP ${entry.tournament.entryFee.toFixed(2)}.` });
      }
    }
    if (purpose === 'ORDER') {
      if (!orderId) return res.status(400).json({ error: 'Select the member order this payment is for.' });
      const order = await prisma.order.findFirst({ where: { id: orderId, userId: req.user.id, source: 'MEMBER_SHOP' } });
      if (!order) return res.status(404).json({ error: 'Member order not found.' });
      if (order.paymentStatus !== 'PENDING') return res.status(409).json({ error: 'This order is no longer awaiting payment.' });
      if (order.paymentMethod !== normalizedMethod) return res.status(400).json({ error: 'Use the payment method selected for this order.' });
      if (Math.abs(order.total - parsedAmount) > 0.01) return res.status(400).json({ error: `The order total is PHP ${order.total.toFixed(2)}.` });
      const existingProof = await prisma.manualPayment.findFirst({ where: { orderId, status: 'PENDING' } });
      if (existingProof) return res.status(409).json({ error: 'A payment proof for this order is already awaiting review.' });
    }

    const receiptUrl = req.file ? `/uploads/payment-proofs/${req.file.filename}` : null;
    const safeReferenceNo = String(referenceNo || '').trim() || `CASH-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const payment = await prisma.manualPayment.create({
      data: {
        userId: req.user.id, purpose, method: normalizedMethod, amount: parsedAmount,
        referenceNo: safeReferenceNo, receiptUrl, notes: String(notes || '').trim() || null,
        tournamentEntryId: purpose === 'TOURNAMENT_ENTRY' ? tournamentEntryId : null,
        orderId: purpose === 'ORDER' ? orderId : null,
      }, include: paymentInclude,
    });

    const isTopUp = purpose === 'CREDIT_TOPUP';
    await prisma.notification.create({ data: {
      userId: req.user.id, type: isTopUp ? 'TOPUP_SUBMITTED' : 'PAYMENT_RECEIVED',
      title: isTopUp ? 'Top-up submitted for verification' : 'Payment submitted for review',
      message: isTopUp
        ? `We received your PHP ${parsedAmount.toFixed(2)} ${normalizedMethod} top-up${normalizedMethod === 'CASH' ? ' request' : ' proof'}. It is pending staff verification and may take a little time to process.`
        : `Your PHP ${parsedAmount.toFixed(2)} ${normalizedMethod} payment is awaiting staff verification.`,
      data: { paymentId: payment.id, purpose }, actionRoute: 'Payments',
    } });
    await notifyStaff({ type: 'PAYMENT_RECEIVED', title: 'New payment awaiting verification', message: `${payment.user.firstName} ${payment.user.lastName} submitted PHP ${parsedAmount.toFixed(2)} via ${normalizedMethod}.`, data: { paymentId: payment.id, purpose }, actionRoute: 'Payments' });

    res.status(201).json({ payment, message: normalizedMethod === 'CASH' ? 'Cash payment request submitted. Please pay staff to complete verification.' : 'Payment proof submitted. Staff will verify it shortly.' });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    if (err.code === 'P2002') return res.status(409).json({ error: 'This transaction reference has already been submitted for this payment method.' });
    console.error('[Manual Payment] Submission failed', err);
    res.status(500).json({ error: 'We could not submit your payment proof. Please try again.' });
  }
});

router.get('/review', authenticate, authorize('ADMIN', 'STAFF'), async (req, res) => {
  try {
    const status = ['PENDING', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED'].includes(req.query.status) ? req.query.status : undefined;
    const query = String(req.query.q || '').trim();
    const payments = await prisma.manualPayment.findMany({
      where: {
        ...(status && { status }),
        ...(query && { OR: [
          { referenceNo: { contains: query, mode: 'insensitive' } },
          { user: { email: { contains: query, mode: 'insensitive' } } },
          { user: { firstName: { contains: query, mode: 'insensitive' } } },
          { user: { lastName: { contains: query, mode: 'insensitive' } } },
        ] }),
      }, include: paymentInclude, orderBy: { createdAt: 'desc' }, take: 100,
    });
    res.json(payments);
  } catch (err) {
    console.error('[Manual Payment] Could not load review queue', err);
    res.status(500).json({ error: 'Could not load the payment review queue.' });
  }
});

router.patch('/:paymentId/review', authenticate, authorize('ADMIN', 'STAFF'), async (req, res) => {
  const { decision, remarks } = req.body;
  if (!['APPROVE', 'REJECT', 'REQUEST_INFORMATION'].includes(decision)) return res.status(400).json({ error: 'Choose approve, reject, or request information.' });
  if (['REJECT', 'REQUEST_INFORMATION'].includes(decision) && !String(remarks || '').trim()) return res.status(400).json({ error: 'Staff remarks are required.' });

  try {
    logPaymentReview('START', {
      paymentId: req.params.paymentId,
      reviewerId: req.user.id,
      reviewerRole: req.user.role,
      decision,
    });
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.manualPayment.findUnique({ where: { id: req.params.paymentId } });
      if (!payment) throw Object.assign(new Error('Payment not found.'), { status: 404 });
      if (payment.status !== 'PENDING') throw Object.assign(new Error('This payment has already been reviewed.'), { status: 409 });
      if (acquireMockId(payment.referenceNo)) throw Object.assign(new Error('Sandbox payments are finalized only after IBHMS verifies AcquireMock status.'), { status: 409 });

      logPaymentReview('PAYMENT_LOADED', {
        paymentId: payment.id,
        purpose: payment.purpose,
        orderId: payment.orderId,
        reviewerId: req.user.id,
        reviewerRole: req.user.role,
        decision,
      });

      const approved = decision === 'APPROVE';
      const needsInformation = decision === 'REQUEST_INFORMATION';
      const updated = await tx.manualPayment.update({ where: { id: payment.id }, data: {
        status: approved ? 'APPROVED' : needsInformation ? 'NEEDS_INFORMATION' : 'REJECTED', reviewerId: req.user.id, reviewedAt: new Date(), reviewerRemarks: String(remarks || '').trim() || null,
      } });

      let updatedBalance = null;
      if (approved && payment.purpose === 'CREDIT_TOPUP') {
        const finalized = await finalizeCreditTopup(tx, payment, { description: `Manual QR top-up via ${payment.method}`, staffId: req.user.id });
        updatedBalance = finalized.balance;
      }
      if (approved && payment.purpose === 'TOURNAMENT_ENTRY') {
        const entry = await tx.tournamentEntry.findFirst({ where: { id: payment.tournamentEntryId, userId: payment.userId } });
        if (!entry) throw Object.assign(new Error('The associated tournament registration was not found.'), { status: 400 });
        const [tournament, activeCount] = await Promise.all([
          tx.tournament.findUnique({ where: { id: entry.tournamentId }, select: { maxPlayers: true } }),
          tx.tournamentEntry.count({ where: { tournamentId: entry.tournamentId, status: { in: ['PENDING_APPROVAL', 'APPROVED', 'CHECKED_IN', 'WINNER'] } } }),
        ]);
        if (!tournament || activeCount >= tournament.maxPlayers) throw Object.assign(new Error('This tournament is already full. The payment was not approved.'), { status: 409 });
        await tx.tournamentEntry.update({ where: { id: entry.id }, data: { status: 'APPROVED', paymentMethod: payment.method, paymentRef: payment.referenceNo, paidAt: new Date(), approvedBy: req.user.id, approvedAt: new Date() } });
      }
      if (approved && payment.purpose === 'ORDER') {
        if (!payment.orderId) throw Object.assign(new Error('The associated member order was not found.'), { status: 400 });
        logPaymentReview('ORDER_FINALIZE_START', { paymentId: payment.id, orderId: payment.orderId, reviewerId: req.user.id });
        await finalizePendingMemberOrder(tx, { orderId: payment.orderId, staffId: req.user.id });
        logPaymentReview('ORDER_FINALIZED', { paymentId: payment.id, orderId: payment.orderId, reviewerId: req.user.id });
      }
      // Retain this branch only so historic membership-payment records remain reviewable.
      if (approved && payment.purpose === 'MEMBERSHIP') {
        await tx.membership.update({ where: { userId: payment.userId }, data: { status: 'ACTIVE' } });
      }

      logPaymentReview('PAYMENT_AUDIT_START', { paymentId: payment.id, purpose: payment.purpose, reviewerId: req.user.id });
      await tx.staffAction.create({ data: { staffId: req.user.id, action: approved ? 'MANUAL_PAYMENT_APPROVED' : needsInformation ? 'MANUAL_PAYMENT_INFO_REQUESTED' : 'MANUAL_PAYMENT_REJECTED', targetId: payment.id, details: { purpose: payment.purpose, amount: payment.amount, referenceNo: payment.referenceNo, remarks: String(remarks || '').trim() || null } } });
      logPaymentReview('PAYMENT_AUDIT_CREATED', { paymentId: payment.id, purpose: payment.purpose, reviewerId: req.user.id });
      await tx.notification.create({ data: {
        userId: payment.userId,
        type: needsInformation ? 'PAYMENT_INFO_REQUIRED' : payment.purpose === 'CREDIT_TOPUP' ? approved ? 'TOPUP_APPROVED' : 'TOPUP_REJECTED' : approved ? 'PAYMENT_RECEIVED' : 'SYSTEM',
        title: needsInformation ? 'More payment information is required' : approved ? payment.purpose === 'CREDIT_TOPUP' ? 'Top-up approved' : 'Payment approved' : payment.purpose === 'CREDIT_TOPUP' ? 'Top-up rejected' : 'Payment rejected',
        message: needsInformation ? `Staff need more information before verifying your payment: ${String(remarks).trim()}. Please submit a clearer or updated proof.` : approved ? payment.purpose === 'CREDIT_TOPUP' ? `Your payment was approved. ${payment.amount.toFixed(0)} credits were added. Your new balance is ${updatedBalance?.toFixed(0) || 'updated'} credits.` : `Your PHP ${payment.amount.toFixed(2)} payment has been approved.` : `Your payment proof was rejected: ${String(remarks).trim()}. You may submit a new proof.`,
        data: { paymentId: payment.id, purpose: payment.purpose }, senderId: req.user.id, actionRoute: 'Payments',
      } });
      return updated;
    }, { maxWait: 10000, timeout: 20000 });
    res.json({ payment: result, message: decision === 'APPROVE' ? 'Payment approved and the account has been updated.' : decision === 'REQUEST_INFORMATION' ? 'The member has been asked for more payment information.' : 'Payment rejected. The member can submit a new proof.' });
  } catch (err) {
    console.error('[Manual Payment] Review failed', {
      name: err.name,
      code: err.code,
      meta: err.meta,
      message: err.message,
      stack: err.stack,
    });
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not review this payment. Please try again.' });
  }
});

router.get('/methods/manage', authenticate, authorize('ADMIN'), async (req, res) => {
  const methods = await prisma.paymentMethodConfig.findMany({ where: { method: { in: QR_METHODS } }, orderBy: { method: 'asc' } });
  res.json(methods.map((method) => publicMethodConfig(req, method)));
});

router.put('/methods/:method', authenticate, authorize('ADMIN'), async (req, res) => {
  const method = String(req.params.method).toUpperCase();
  const { businessName, accountName, qrCodeUrl } = req.body;
  if (!validQrMethod(method)) return res.status(400).json({ error: 'Only GCash and Maya QR methods can be configured.' });
  if (!String(businessName || '').trim() || !String(accountName || '').trim()) return res.status(400).json({ error: 'Business name and account name are required.' });
  try {
    // A text-only save deliberately omits qrCodeUrl so Prisma keeps the
    // existing persisted QR. Only an already durable server Storage URL may
    // be carried through this endpoint.
    const config = await savePaymentMethodConfig({ method, ...req.body }, isStoredQrUrl(qrCodeUrl) ? qrCodeUrl : undefined);
    res.json(publicMethodConfig(req, config));
  } catch (err) { console.error('[Manual Payment] Method configuration failed', err); res.status(500).json({ error: 'Could not save the payment method.' }); }
});

router.post('/methods/:method/qr', logQrRawRequest, authenticate, authorize('ADMIN'), qrUpload.single('qrCode'), async (req, res) => {
  const method = String(req.params.method).toUpperCase();
  console.log('[QR Upload] request received', { method, hasFile: Boolean(req.file), mimeType: req.file?.mimetype || null, size: req.file?.size || null });
  if (!validQrMethod(method)) {
    removeLocalUpload(req.file);
    return res.status(400).json({ error: 'Only GCash and Maya QR methods can be configured.' });
  }
  if (!req.file) return res.status(400).json({ error: 'Upload a QR code image.' });
  try {
    const existing = await prisma.paymentMethodConfig.findUnique({ where: { method } });
    const uploadDetails = existing || paymentMethodDetails(req.body);
    if (!uploadDetails.businessName || !uploadDetails.accountName) {
      throw Object.assign(new Error('Save the payment method details first, then upload its QR image.'), { status: 400 });
    }

    const uploaded = await uploadQrToStorage(method, req.file);
    let config;
    try {
      // The durable URL is supplied to both upsert paths. This also handles a
      // rare create/update race without losing the uploaded QR.
      config = await savePaymentMethodConfig({ method, ...uploadDetails }, uploaded.publicUrl);
    } catch (err) {
      await removeStoredQr(uploaded.publicUrl);
      throw err;
    }
    removeLocalUpload(req.file);
    removeStoredQr(existing?.qrCodeUrl).catch(() => {});
    res.json(publicMethodConfig(req, config));
  } catch (err) {
    removeLocalUpload(req.file);
    console.error('[Manual Payment] QR upload failed', { message: err.message, status: err.status, method });
    res.status(err.status || 500).json({ error: err.status === 400 ? err.message : 'Could not upload the QR image. Please try again.' });
  }
});

router.use((err, _req, res, next) => {
  if (!err) return next();
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Images must be 5 MB or smaller.' });
  if (err instanceof multer.MulterError && err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Use the QR image field expected by the server.' });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: 'The QR image upload was malformed. Please choose the image again.' });
  if (err.message === 'QR_IMAGE_TYPE_INVALID') return res.status(400).json({ error: 'Please choose a PNG, JPEG, or WEBP QR image.' });
  if (err.message === 'Only image receipt files are allowed.') return res.status(400).json({ error: 'Only JPG, PNG, WEBP, and other image files are supported.' });
  return next(err);
});

module.exports = router;
// Kept on the router solely for the focused no-network storage contract test.
module.exports._qrStorage = { uploadQrToStorage, removeStoredQr, savePaymentMethodConfig };
