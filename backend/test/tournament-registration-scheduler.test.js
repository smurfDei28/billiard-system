const assert = require('node:assert/strict');
const test = require('node:test');

const {
  REGISTRATION_DEADLINE_INTERVAL_MS,
  processDueTournamentRegistrationDeadlines,
  startTournamentRegistrationScheduler,
  stopTournamentRegistrationScheduler,
} = require('../src/services/tournamentRegistrationScheduler');

const silentLogger = { error: () => {} };

const dueDb = (tournaments) => ({
  tournament: {
    findMany: async ({ where }) => tournaments.filter((tournament) =>
      tournament.registrationDeadline != null &&
      tournament.registrationDeadline <= where.registrationDeadline.lte &&
      where.status.in.includes(tournament.status)
    ).map(({ id }) => ({ id })),
  },
});

test('processes each due registration deadline and ignores future, null-deadline, and finalized tournaments', async () => {
  const now = new Date('2026-08-08T12:00:00.000Z');
  const closed = [];
  const result = await processDueTournamentRegistrationDeadlines({
    now,
    logger: silentLogger,
    db: dueDb([
      { id: 'due-a', registrationDeadline: new Date('2026-08-08T11:59:00.000Z'), status: 'REGISTRATION_OPEN' },
      { id: 'due-b', registrationDeadline: now, status: 'UPCOMING' },
      { id: 'future', registrationDeadline: new Date('2026-08-08T12:01:00.000Z'), status: 'REGISTRATION_OPEN' },
      { id: 'legacy', registrationDeadline: null, status: 'REGISTRATION_OPEN' },
      { id: 'closed', registrationDeadline: new Date('2026-08-08T11:00:00.000Z'), status: 'REGISTRATION_CLOSED' },
    ]),
    closeRegistration: async (id) => closed.push(id),
  });

  assert.deepEqual(closed, ['due-a', 'due-b']);
  assert.deepEqual(result, { processed: 2, failed: 0 });
});

test('isolates a failed close so later due tournaments are still attempted', async () => {
  const attempted = [];
  const result = await processDueTournamentRegistrationDeadlines({
    now: new Date('2026-08-08T12:00:00.000Z'),
    logger: silentLogger,
    db: dueDb([
      { id: 'fails', registrationDeadline: new Date('2026-08-08T11:00:00.000Z'), status: 'REGISTRATION_OPEN' },
      { id: 'succeeds', registrationDeadline: new Date('2026-08-08T11:00:00.000Z'), status: 'REGISTRATION_OPEN' },
    ]),
    closeRegistration: async (id) => {
      attempted.push(id);
      if (id === 'fails') throw new Error('temporary database issue');
    },
  });

  assert.deepEqual(attempted, ['fails', 'succeeds']);
  assert.deepEqual(result, { processed: 1, failed: 1 });
});

test('a repeat scheduler cycle relies on close-service finalization and does not reselect a closed tournament', async () => {
  const tournament = { id: 'repeat', registrationDeadline: new Date('2026-08-08T11:00:00.000Z'), status: 'REGISTRATION_OPEN' };
  const closed = [];
  const options = {
    now: new Date('2026-08-08T12:00:00.000Z'),
    logger: silentLogger,
    db: dueDb([tournament]),
    closeRegistration: async (id) => {
      closed.push(id);
      tournament.status = 'REGISTRATION_CLOSED';
    },
  };

  await processDueTournamentRegistrationDeadlines(options);
  await processDueTournamentRegistrationDeadlines(options);

  assert.deepEqual(closed, ['repeat']);
});

test('scheduler starts one non-blocking interval per process and can be stopped for tests', async () => {
  stopTournamentRegistrationScheduler();
  let cycles = 0;
  const first = startTournamentRegistrationScheduler({ intervalMs: REGISTRATION_DEADLINE_INTERVAL_MS, runCycle: async () => { cycles += 1; }, logger: silentLogger });
  const second = startTournamentRegistrationScheduler({ intervalMs: 5, runCycle: async () => { cycles += 1; }, logger: silentLogger });

  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cycles, 1);
  stopTournamentRegistrationScheduler();
});
