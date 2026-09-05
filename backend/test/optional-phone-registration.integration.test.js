const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const { registerValidation, registerWithDependencies } = require('../src/controllers/auth.controller');

const makeDb = (initialUsers = []) => {
  const users = initialUsers.map((user) => ({ ...user }));
  const tx = {
    user: {
      create: async ({ data }) => {
        const created = { id: `user-${users.length + 1}`, ...data };
        users.push(created);
        return created;
      },
    },
    membership: { create: async ({ data }) => data },
    gamifiedProfile: { create: async ({ data }) => data },
  };
  return {
    users,
    user: {
      findFirst: async ({ where }) => users.find((user) => where.OR.some((condition) =>
        Object.entries(condition).every(([field, value]) => user[field] === value)
      )) || null,
    },
    $transaction: async (callback) => callback(tx),
  };
};

const startRegistrationServer = async (db) => {
  const app = express();
  app.use(express.json());
  app.post('/register', registerValidation, (req, res) => registerWithDependencies(req, res, {
    db,
    sendVerification: async () => {},
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}/register`,
  };
};

const register = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Test',
      lastName: 'Member',
      password: 'StrongPass1!',
      ...body,
    }),
  });
  return { status: response.status, body: await response.json() };
};

test('registration stores missing, null, empty, and whitespace-only phone values as null', async (t) => {
  const db = makeDb();
  const { server, url } = await startRegistrationServer(db);
  t.after(() => server.close());

  for (const [index, phone] of [undefined, null, '', '   '].entries()) {
    const body = { email: `phone-free-${index}@example.com` };
    if (phone !== undefined) body.phone = phone;
    const response = await register(url, body);
    assert.equal(response.status, 201, JSON.stringify(response.body));
  }

  assert.equal(db.users.length, 4);
  assert.deepEqual(db.users.map((user) => user.phone), [null, null, null, null]);
});

test('registration normalizes a provided phone and still rejects duplicates and invalid numbers', async (t) => {
  const db = makeDb();
  const { server, url } = await startRegistrationServer(db);
  t.after(() => server.close());

  const first = await register(url, { email: 'with-phone@example.com', phone: ' 09171234567 ' });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(db.users[0].phone, '09171234567');

  const duplicate = await register(url, { email: 'duplicate-phone@example.com', phone: '09171234567' });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.error, /Phone number is already registered/);

  const invalid = await register(url, { email: 'invalid-phone@example.com', phone: '12345' });
  assert.equal(invalid.status, 400);
  assert.equal(db.users.length, 1);
});

test('nullable-phone migration preserves saved phones and the unique declaration', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '20260906010000_make_user_phone_optional', 'migration.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');

  assert.match(migration, /ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL/);
  assert.doesNotMatch(migration, /UPDATE|DELETE|DROP (TABLE|INDEX)|TRUNCATE/i);
  assert.match(schema, /phone\s+String\?\s+@unique/);
});
