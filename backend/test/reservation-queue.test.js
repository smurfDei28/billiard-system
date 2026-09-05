const assert = require('node:assert/strict');
const test = require('node:test');
const { reservationIntervalsOverlap } = require('../src/controllers/reservation.controller');
const { buildReservationQueue } = require('../src/controllers/queue.controller');
const { hasMinimumWalkInDuration, resolveWalkInExpectedEnd } = require('../src/controllers/table.controller');

test('reservation overlap uses proper interval boundaries', () => {
  const existingStart = new Date('2026-08-17T20:00:00+08:00');
  const existingEnd = new Date('2026-08-17T21:00:00+08:00');
  assert.equal(reservationIntervalsOverlap(new Date('2026-08-17T20:30:00+08:00'), new Date('2026-08-17T21:30:00+08:00'), existingStart, existingEnd), true);
  assert.equal(reservationIntervalsOverlap(new Date('2026-08-17T21:00:00+08:00'), new Date('2026-08-17T22:00:00+08:00'), existingStart, existingEnd), false);
});

test('reservation queue positions are ordered by scheduled start time per table', () => {
  const schedule = buildReservationQueue([
    { id: 'later', tableId: 'table-a', startTime: new Date('2026-08-17T10:30:00Z') },
    { id: 'other-table', tableId: 'table-b', startTime: new Date('2026-08-17T10:00:00Z') },
    { id: 'first', tableId: 'table-a', startTime: new Date('2026-08-17T08:00:00Z') },
    { id: 'second', tableId: 'table-a', startTime: new Date('2026-08-17T09:00:00Z') },
  ]);
  assert.deepEqual(schedule.filter((entry) => entry.tableId === 'table-a').map((entry) => [entry.id, entry.position]), [['first', 1], ['second', 2], ['later', 3]]);
  assert.equal(schedule.find((entry) => entry.id === 'other-table').position, 1);
});

test('walk-in expected end requires the existing 30-minute minimum and allows a reservation-adjacent end', () => {
  const start = new Date('2026-08-17T19:00:00+08:00');
  assert.equal(hasMinimumWalkInDuration(start, new Date('2026-08-17T19:15:00+08:00')), false);
  assert.equal(hasMinimumWalkInDuration(start, new Date('2026-08-17T19:30:00+08:00')), true);
  assert.equal(reservationIntervalsOverlap(start, new Date('2026-08-17T20:00:00+08:00'), new Date('2026-08-17T20:00:00+08:00'), new Date('2026-08-17T21:00:00+08:00')), false);
});

test('walk-in time selections roll over to the next calendar day before minimum validation', () => {
  const resolve = (start, selected) => resolveWalkInExpectedEnd(new Date(start), new Date(selected));
  const elevenAm = '2026-08-17T11:00:00+08:00';
  assert.equal(resolve(elevenAm, '2026-08-17T11:30:00+08:00').toISOString(), '2026-08-17T03:30:00.000Z');
  assert.equal(resolve(elevenAm, '2026-08-17T12:00:00+08:00').toISOString(), '2026-08-17T04:00:00.000Z');
  assert.equal(resolve(elevenAm, '2026-08-17T00:00:00+08:00').toISOString(), '2026-08-17T16:00:00.000Z');
  assert.equal(resolve('2026-08-17T23:00:00+08:00', '2026-08-17T00:00:00+08:00').toISOString(), '2026-08-17T16:00:00.000Z');
  assert.equal(resolve(elevenAm, elevenAm).toISOString(), '2026-08-18T03:00:00.000Z');

  const elevenFortyFivePm = '2026-08-17T23:45:00+08:00';
  const twelveFifteen = resolve(elevenFortyFivePm, '2026-08-17T00:15:00+08:00');
  const midnight = resolve(elevenFortyFivePm, '2026-08-17T00:00:00+08:00');
  assert.equal(hasMinimumWalkInDuration(new Date(elevenFortyFivePm), twelveFifteen), true);
  assert.equal(hasMinimumWalkInDuration(new Date(elevenFortyFivePm), midnight), false);
});

test('cross-midnight expected ends remain adjacent to reservations without overlap', () => {
  const start = new Date('2026-08-17T23:00:00+08:00');
  const reservationStart = new Date('2026-08-18T01:00:00+08:00');
  const reservationEnd = new Date('2026-08-18T02:00:00+08:00');
  assert.equal(reservationIntervalsOverlap(start, reservationStart, reservationStart, reservationEnd), false);
  assert.equal(reservationIntervalsOverlap(start, new Date('2026-08-18T01:30:00+08:00'), reservationStart, reservationEnd), true);
});
