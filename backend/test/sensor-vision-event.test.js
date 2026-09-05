const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizePocketEvent, findDuplicateEvent } = require('../src/utils/sensorEvents');

test('accepts a complete camera-vision pocket event', () => {
  const result = normalizePocketEvent({
    tableId: 'table-1', sessionId: 'game-1', eventId: 'evt-1',
    pocket: 'top_left', ballColor: 'Stripe', confidence: 0.87,
    source: 'CAMERA_VISION', requiresConfirmation: false,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.event.pocket, 'TOP_LEFT');
  assert.equal(result.event.ballColor, 'stripe');
});

test('camera events cannot bypass the manual-confirmation safety gate', () => {
  const result = normalizePocketEvent({
    tableId: 'table-1', sessionId: 'game-1', eventId: 'evt-1',
    pocket: 'TOP_LEFT', ballColor: 'cue', confidence: 0.91,
    source: 'CAMERA_VISION', requiresConfirmation: true,
  });
  assert.equal(result.requiresConfirmation, true);
});

test('requires idempotency fields for camera events', () => {
  const result = normalizePocketEvent({
    tableId: 'table-1', pocket: 'TOP_LEFT', ballColor: 'solid',
    source: 'CAMERA_VISION', confidence: 0.8,
  });
  assert.match(result.error, /sessionId and eventId/);
});

test('recognizes a retried event already stored in ballsPotted', () => {
  const existing = { eventId: 'evt-1', ballColor: 'stripe' };
  assert.equal(findDuplicateEvent([existing], 'evt-1'), existing);
  assert.equal(findDuplicateEvent([existing], 'evt-2'), null);
});
