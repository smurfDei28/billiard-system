const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');

const LEGACY_RECORD_PREFIX = 'ACQUIREMOCK-';
const VALID_SCENARIOS = new Set(['success', 'failed', 'pending', 'cancelled']);

const enabled = () => {
  const configured = process.env.GCASH_SANDBOX_ENABLED ?? process.env.ACQUIREMOCK_ENABLED;
  return String(configured || '').toLowerCase() === 'true';
};

const defaultScenario = () => {
  const configured = String(process.env.GCASH_SANDBOX_DEFAULT_SCENARIO || 'success').toLowerCase();
  return VALID_SCENARIOS.has(configured) ? configured : 'success';
};

const pendingSeconds = () => {
  const configured = Number(process.env.GCASH_SANDBOX_PENDING_SECONDS || 10);
  return Number.isFinite(configured) && configured >= 0 ? configured : 10;
};

const statusForScenario = (scenario) => ({
  success: 'paid',
  failed: 'failed',
  pending: 'pending',
  cancelled: 'cancelled',
})[scenario];

const scenarioForStatus = (status) => ({
  paid: 'success',
  failed: 'failed',
  pending: 'pending',
  cancelled: 'cancelled',
})[status] || 'pending';

const statusFromNotes = (notes) => String(notes || '').match(/status=(paid|failed|pending|cancelled)/i)?.[1]?.toLowerCase() || 'pending';
const scenarioFromNotes = (notes) => String(notes || '').match(/scenario=(success|failed|pending|cancelled)/i)?.[1]?.toLowerCase() || scenarioForStatus(statusFromNotes(notes));
const resolvedStatus = (payment) => {
  const scenario = scenarioFromNotes(payment.notes);
  const storedStatus = statusFromNotes(payment.notes);
  if (storedStatus !== 'pending' || scenario !== 'pending') return storedStatus;
  const ageSeconds = (Date.now() - new Date(payment.createdAt).getTime()) / 1000;
  return ageSeconds >= pendingSeconds() ? 'paid' : 'pending';
};

const response = ({ id, amount, reference, scenario, status }) => ({
  id,
  provider: 'gcash',
  environment: 'sandbox',
  amount,
  currency: 'PHP',
  status,
  reference,
  mockReference: `gcash_sandbox_${id}`,
  scenario,
  failureReason: status === 'failed' ? 'Payment rejected by the configured sandbox scenario.' : null,
});

const findPayment = async (id) => {
  const payment = await prisma.manualPayment.findFirst({
    where: { referenceNo: `${LEGACY_RECORD_PREFIX}${id}`, method: 'GCASH' },
  });
  if (!payment) throw Object.assign(new Error('Sandbox payment was not found.'), { status: 404 });
  return payment;
};

const createPayment = (body = {}) => {
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0 || String(body.currency || '').toUpperCase() !== 'PHP') {
    throw Object.assign(new Error('The GCash sandbox payment request is invalid.'), { status: 400 });
  }
  const scenario = defaultScenario();
  return response({
    id: randomUUID(),
    amount,
    reference: String(body.reference || '').trim(),
    scenario,
    status: statusForScenario(scenario),
  });
};

const readPayment = async (id) => {
  const payment = await findPayment(id);
  const scenario = scenarioFromNotes(payment.notes);
  const status = resolvedStatus(payment);
  return response({ id, amount: Math.round(Number(payment.amount) * 100), reference: payment.referenceNo, scenario, status });
};

const cancelPayment = async (id) => {
  const payment = await findPayment(id);
  const status = resolvedStatus(payment);
  if (status !== 'pending') throw Object.assign(new Error('This sandbox payment has already been processed.'), { status: 409 });
  return response({
    id,
    amount: Math.round(Number(payment.amount) * 100),
    reference: payment.referenceNo,
    scenario: 'cancelled',
    status: 'cancelled',
  });
};

const request = async (pathname, options = {}) => {
  if (!enabled()) throw Object.assign(new Error('GCash sandbox is disabled.'), { status: 503 });
  const method = String(options.method || 'GET').toUpperCase();
  if (pathname === '/api/payments/gcash/mock' && method === 'POST') {
    let body;
    try { body = JSON.parse(options.body || '{}'); } catch { body = {}; }
    return createPayment(body);
  }
  const match = pathname.match(/^\/api\/payments\/gcash\/mock\/([^/]+)(\/cancel)?$/);
  if (!match) throw Object.assign(new Error('GCash sandbox route was not found.'), { status: 404 });
  const id = decodeURIComponent(match[1]);
  if (match[2] && method === 'POST') return cancelPayment(id);
  if (!match[2] && method === 'GET') return readPayment(id);
  throw Object.assign(new Error('GCash sandbox method is not supported.'), { status: 405 });
};

module.exports = { enabled, request, _test: { defaultScenario, pendingSeconds, statusForScenario, statusFromNotes, scenarioFromNotes, resolvedStatus } };
