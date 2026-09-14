const test = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../src/config/prisma');
const { pocketDetected } = require('../src/controllers/sensor.controller');

const responseRecorder = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('mismatched camera session is rejected before a reading is created', async (t) => {
  const originalReading = prisma.sensorReading;
  const originalGameScore = prisma.gameScore;
  let createCalls = 0;

  prisma.sensorReading = {
    findUnique: async () => null,
    create: async () => { createCalls += 1; throw new Error('must not create'); },
  };
  prisma.gameScore = {
    findUnique: async () => ({
      sessionId: 'game-1', tableId: 'table-2', status: 'IN_PROGRESS', ballsPotted: [],
    }),
  };
  t.after(() => {
    prisma.sensorReading = originalReading;
    prisma.gameScore = originalGameScore;
  });

  const req = {
    body: {
      eventId: 'event-1', tableId: 'table-1', sessionId: 'game-1',
      pocket: 'TOP_LEFT', ballColor: 'solid', source: 'CAMERA_VISION',
    },
  };
  const res = responseRecorder();

  await pocketDetected(req, res);

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /different table/);
  assert.equal(createCalls, 0);
});
