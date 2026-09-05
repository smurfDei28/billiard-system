const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { isOnlineReservationPaymentMethod } = require('../src/controllers/reservation.controller');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'reservation.controller.js'), 'utf8');

test('new online reservations allow Credits and reject Cash without changing historical Cash parsing', () => {
  assert.equal(isOnlineReservationPaymentMethod('CREDITS'), true);
  assert.equal(isOnlineReservationPaymentMethod(undefined), true);
  assert.equal(isOnlineReservationPaymentMethod('CASH'), false);
  assert.equal(isOnlineReservationPaymentMethod('GCASH'), false);
  assert.match(source, /Cash payment is not available for online reservations\. Please use Credits\./);
  assert.match(source, /const selectedPaymentMethod = 'CREDITS'/);
  assert.match(source, /parseReservationPaymentMethod\(reservation\.notes\)/);
});

test('new online reservation credit validation has no cash fallback', () => {
  assert.match(source, /Insufficient credits\. You need at least \$\{estimatedCost\.toFixed\(0\)\} credits for this reservation\./);
  assert.doesNotMatch(source, /for this reservation, or choose cash payment/);
});
