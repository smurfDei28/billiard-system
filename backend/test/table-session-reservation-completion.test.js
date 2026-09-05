const assert = require('node:assert/strict');
const test = require('node:test');
const { completeLinkedReservation } = require('../src/controllers/table.controller');

const session = { tableId: 'table-1', startTime: new Date('2026-08-13T11:00:00.000Z') };

test('ending a scheduler-originated reserved session completes only its exact linked reservation', async () => {
  const updates = [];
  const tx = { reservation: {
    findFirst: async ({ where }) => {
      assert.deepEqual(where, { tableId: 'table-1', status: 'APPROVED', startTime: session.startTime });
      return { id: 'current-reservation' };
    },
    update: async (input) => { updates.push(input); return { id: input.where.id, status: input.data.status }; },
  } };
  assert.deepEqual(await completeLinkedReservation(tx, session), { id: 'current-reservation', status: 'COMPLETED' });
  assert.deepEqual(updates, [{ where: { id: 'current-reservation' }, data: { status: 'COMPLETED' } }]);
});

test('ending a walk-in session does not complete a nearby or future reservation', async () => {
  const tx = { reservation: {
    findFirst: async () => null,
    update: async () => assert.fail('walk-in session must not update a reservation'),
  } };
  assert.equal(await completeLinkedReservation(tx, { tableId: 'table-1', startTime: new Date('2026-08-13T11:01:00.000Z') }), null);
});
