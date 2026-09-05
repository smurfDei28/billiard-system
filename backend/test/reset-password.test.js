const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const test = require('node:test');
const prisma = require('../src/config/prisma');
const { resetPassword } = require('../src/controllers/auth.controller');

const passwordSecret = process.env.JWT_PASSWORD_RESET_SECRET || process.env.JWT_SECRET;
const request = (token, password, confirmPassword = password) => ({ body: { token, password, confirmPassword }, headers: { accept: 'application/json' } });
const response = () => {
  const state = { statusCode: 200, body: null };
  return {
    state,
    status(code) { state.statusCode = code; return this; },
    json(body) { state.body = body; return this; },
    send(body) { state.body = body; return this; },
  };
};

const replacePrisma = () => {
  const original = { user: prisma.user, refreshToken: prisma.refreshToken, transaction: prisma.$transaction };
  let passwordHash = bcrypt.hashSync('OldPassword1!', 4);
  let revoked = 0;
  const issuedBeforeUpdate = new Date(Date.now() - 2_000);
  prisma.user = {
    findUnique: async () => ({ id: 'member-1', isEmailVerified: true, password: passwordHash, updatedAt: issuedBeforeUpdate }),
    update: ({ data }) => {
      passwordHash = data.password;
      return Promise.resolve({ id: 'member-1' });
    },
  };
  prisma.refreshToken = { deleteMany: () => { revoked += 1; return Promise.resolve({ count: 2 }); } };
  prisma.$transaction = async (operations) => Promise.all(operations);
  return {
    state: () => ({ passwordHash, revoked }),
    restore: () => Object.assign(prisma, { user: original.user, refreshToken: original.refreshToken, $transaction: original.transaction }),
  };
};

test('reset password replaces the User.password hash, revokes refresh tokens, and rejects the old password', async () => {
  const mock = replacePrisma();
  try {
    const token = jwt.sign({ userId: 'member-1', purpose: 'PASSWORD_RESET' }, passwordSecret, { expiresIn: '1h' });
    const res = response();
    await resetPassword(request(token, 'NewPassword1!'), res);

    const state = mock.state();
    assert.equal(res.state.statusCode, 200);
    assert.equal(res.state.body.message, 'Password reset successful');
    assert.equal(await bcrypt.compare('NewPassword1!', state.passwordHash), true);
    assert.equal(await bcrypt.compare('OldPassword1!', state.passwordHash), false);
    assert.equal(state.revoked, 1);
  } finally {
    mock.restore();
  }
});

test('reset password rejects weak, expired, and already-used reset tokens', async () => {
  const mock = replacePrisma();
  try {
    const validToken = jwt.sign({ userId: 'member-1', purpose: 'PASSWORD_RESET' }, passwordSecret, { expiresIn: '1h' });
    const weak = response();
    await resetPassword(request(validToken, 'Password1'), weak);
    assert.equal(weak.state.statusCode, 400);
    assert.match(weak.state.body.error, /special character/);

    const expiredToken = jwt.sign({ userId: 'member-1', purpose: 'PASSWORD_RESET' }, passwordSecret, { expiresIn: -1 });
    const expired = response();
    await resetPassword(request(expiredToken, 'NewPassword1!'), expired);
    assert.equal(expired.state.statusCode, 400);
    assert.match(expired.state.body.error, /expired/);

    prisma.user.findUnique = async () => ({ id: 'member-1', isEmailVerified: true, updatedAt: new Date() });
    const used = response();
    await resetPassword(request(validToken, 'NewPassword1!'), used);
    assert.equal(used.state.statusCode, 400);
    assert.match(used.state.body.error, /already been used/);
  } finally {
    mock.restore();
  }
});

test('reset password rejects a mismatched confirmation before updating the password', async () => {
  const mock = replacePrisma();
  try {
    const token = jwt.sign({ userId: 'member-1', purpose: 'PASSWORD_RESET' }, passwordSecret, { expiresIn: '1h' });
    const res = response();
    await resetPassword(request(token, 'NewPassword1!', 'DifferentPassword1!'), res);
    assert.equal(res.state.statusCode, 400);
    assert.equal(res.state.body.error, 'The passwords do not match.');
    assert.equal(await bcrypt.compare('OldPassword1!', mock.state().passwordHash), true);
  } finally {
    mock.restore();
  }
});

test('HTML reset success is explicit and HTML errors remain friendly', async () => {
  const mock = replacePrisma();
  try {
    const token = jwt.sign({ userId: 'member-1', purpose: 'PASSWORD_RESET' }, passwordSecret, { expiresIn: '1h' });
    const htmlRequest = (password, confirmPassword = password) => ({
      body: { token, password, confirmPassword },
      headers: { accept: 'text/html' },
    });

    const success = response();
    await resetPassword(htmlRequest('NewPassword1!'), success);
    assert.equal(success.state.statusCode, 200);
    assert.match(success.state.body, /Password Updated/);
    assert.match(success.state.body, /password has been updated successfully/i);
    assert.match(success.state.body, /Continue to Login/);

    const mismatch = response();
    await resetPassword(htmlRequest('NewPassword1!', 'DifferentPassword1!'), mismatch);
    assert.equal(mismatch.state.statusCode, 400);
    assert.match(mismatch.state.body, /The passwords do not match\./);
    assert.doesNotMatch(mismatch.state.body, /PrismaClient|JsonWebTokenError|auth\.controller\.js/);
  } finally {
    mock.restore();
  }
});
