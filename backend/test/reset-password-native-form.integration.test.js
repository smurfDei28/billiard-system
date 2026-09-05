const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const express = require('express');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const test = require('node:test');
const prisma = require('../src/config/prisma');
const authRoutes = require('../src/routes/auth.routes');

const passwordSecret = process.env.JWT_PASSWORD_RESET_SECRET || process.env.JWT_SECRET;

const withNativeFormServer = async (run) => {
  const original = { user: prisma.user, refreshToken: prisma.refreshToken, transaction: prisma.$transaction };
  let passwordHash = bcrypt.hashSync('OldPassword1!', 4);
  const issuedBeforeUpdate = new Date(Date.now() - 2_000);
  prisma.user = {
    findUnique: async () => ({ id: 'native-form-member', isEmailVerified: true, password: passwordHash, updatedAt: issuedBeforeUpdate }),
    update: async ({ data }) => {
      passwordHash = data.password;
      return { id: 'native-form-member' };
    },
  };
  prisma.refreshToken = { deleteMany: async () => ({ count: 1 }) };
  prisma.$transaction = async (operations) => Promise.all(operations);

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api/auth', authRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    await run({ port: server.address().port, passwordHash: () => passwordHash });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    Object.assign(prisma, { user: original.user, refreshToken: original.refreshToken, $transaction: original.transaction });
  }
};

const submitNativeForm = (port, body) => new Promise((resolve, reject) => {
  const encodedBody = new URLSearchParams(body).toString();
  const request = http.request({
    hostname: '127.0.0.1',
    port,
    path: '/api/auth/reset-password',
    method: 'POST',
    headers: {
      Accept: 'text/html',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(encodedBody),
    },
  }, (response) => {
    let text = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { text += chunk; });
    response.on('end', () => resolve({ response, text }));
  });
  request.on('error', reject);
  request.end(encodedBody);
});

test('native URL-encoded reset form reaches the actual auth route, updates the password, and returns success HTML', async () => {
  await withNativeFormServer(async ({ port, passwordHash }) => {
    const token = jwt.sign({ userId: 'native-form-member', purpose: 'PASSWORD_RESET' }, passwordSecret, { expiresIn: '1h' });
    const { response, text } = await submitNativeForm(port, {
      token,
      password: 'NewPassword1!',
      confirmPassword: 'NewPassword1!',
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'], /text\/html/);
    assert.match(text, /Password Updated/);
    assert.equal(await bcrypt.compare('NewPassword1!', passwordHash()), true);
    assert.equal(await bcrypt.compare('OldPassword1!', passwordHash()), false);
  });
});
