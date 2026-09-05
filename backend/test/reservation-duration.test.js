const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  MIN_RESERVATION_DURATION_MS,
  hasMinimumReservationDuration,
} = require('../src/controllers/reservation.controller');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'reservation.controller.js'), 'utf8');
const start = new Date('2026-08-12T10:00:00.000Z');
const endsAfter = (minutes) => new Date(start.getTime() + minutes * 60 * 1000);

test('new reservations reject every duration shorter than 30 minutes', () => {
  assert.equal(MIN_RESERVATION_DURATION_MS, 30 * 60 * 1000);
  for (const minutes of [1, 15, 29]) {
    assert.equal(hasMinimumReservationDuration(start, endsAfter(minutes)), false, `${minutes} minutes`);
  }
});

test('new reservations accept the exact 30-minute boundary and longer durations', () => {
  for (const minutes of [30, 31, 45, 60]) {
    assert.equal(hasMinimumReservationDuration(start, endsAfter(minutes)), true, `${minutes} minutes`);
  }
});

test('duration validation leaves existing reservation pricing and overlap guards in place', () => {
  assert.match(source, /Reservation duration must be at least 30 minutes\./);
  assert.match(source, /const estimatedCost = \(reservedMinutes \/ 60\) \* table\.ratePerHour/);
  assert.match(source, /status: \{ in: \['PENDING', 'APPROVED'\] \}/);
  assert.match(source, /startTime: \{ lt: end \}, endTime: \{ gt: start \}/);
});
