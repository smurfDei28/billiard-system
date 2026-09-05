const assert = require('node:assert/strict');
const test = require('node:test');
const ops = require('../src/services/tournamentMatchOperations.service');

const makeDb = ({ match = {}, table = { id: 'table-1', status: 'AVAILABLE' }, session = null, reservation = null, other = null, scheduledOther = null } = {}) => {
  const stored = { id: 'match-1', tournamentId: 't-1', status: 'PENDING', player1Id: 'a', player2Id: 'b', tableId: null, tournament: { status: 'IN_PROGRESS' }, ...match };
  const calls = { sessions: 0, tableUpdates: 0 };
  const db = {
    tournamentMatch: {
      findUnique: async () => ({ ...stored }),
      findFirst: async ({ where }) => where.scheduledAt ? scheduledOther : other,
      update: async ({ data }) => Object.assign(stored, data),
    },
    billiardTable: { findUnique: async () => table, updateMany: async () => ({ count: table.status === 'AVAILABLE' ? 1 : 0 }), update: async () => { calls.tableUpdates += 1; } },
    tableSession: { findFirst: async () => { calls.sessions += 1; return session; } },
    reservation: { findFirst: async () => reservation },
  };
  return { db, stored, calls };
};

test('schedules a pending match and rejects completed/BYE matches', async () => {
  const valid = makeDb();
  const scheduled = await ops.scheduleTournamentMatch({ db: valid.db, matchId: 'match-1', scheduledAt: '2026-08-10T10:00:00Z' });
  assert.equal(new Date(scheduled.scheduledAt).toISOString(), '2026-08-10T10:00:00.000Z');
  await assert.rejects(() => ops.scheduleTournamentMatch({ db: makeDb({ match: { status: 'COMPLETED' } }).db, matchId: 'x', scheduledAt: new Date() }), /not operationally editable/);
  await assert.rejects(() => ops.scheduleTournamentMatch({ db: makeDb({ match: { status: 'BYE' } }).db, matchId: 'x', scheduledAt: new Date() }), /not operationally editable/);
});

test('assigns an available table and rejects table, session, reservation, and tournament conflicts', async () => {
  const good = makeDb();
  assert.equal((await ops.assignTournamentTable({ db: good.db, matchId: 'match-1', tableId: 'table-1' })).tableId, 'table-1');
  for (const setup of [{ table: { id: 'table-1', status: 'OCCUPIED' } }, { session: { id: 's' } }, { reservation: { id: 'r' } }, { other: { id: 'other' } }]) {
    await assert.rejects(() => ops.assignTournamentTable({ db: makeDb(setup).db, matchId: 'match-1', tableId: 'table-1' }), /not available/);
  }
});

test('rejects duplicate table-and-time match setup and saves setup atomically', async () => {
  const at = '2026-08-20T10:00:00Z';
  const conflict = makeDb({ scheduledOther: { id: 'other-match' } });
  await assert.rejects(
    () => ops.setupTournamentMatch({ db: conflict.db, matchId: 'match-1', tableId: 'table-1', scheduledAt: at }),
    /already has a match scheduled at that time/i,
  );

  const good = makeDb();
  const setup = await ops.setupTournamentMatch({ db: good.db, matchId: 'match-1', tableId: 'table-1', scheduledAt: at });
  assert.equal(setup.tableId, 'table-1');
  assert.equal(new Date(setup.scheduledAt).toISOString(), '2026-08-20T10:00:00.000Z');
});

test('starts once without a TableSession or billing and rejects missing setup/BYE starts', async () => {
  const live = makeDb({ match: { tableId: 'table-1', scheduledAt: new Date('2026-08-10T10:00:00Z') } });
  const started = await ops.startTournamentMatch({ db: live.db, matchId: 'match-1' });
  assert.equal(started.match.status, 'IN_PROGRESS');
  assert.ok(started.match.startedAt);
  assert.equal(live.calls.sessions, 1);
  assert.equal(live.db.tableSession.create, undefined);
  const retry = await ops.startTournamentMatch({ db: live.db, matchId: 'match-1' });
  assert.equal(retry.alreadyStarted, true);
  await assert.rejects(() => ops.startTournamentMatch({ db: makeDb().db, matchId: 'x' }), /assign a schedule and table/i);
  await assert.rejects(() => ops.startTournamentMatch({ db: makeDb({ match: { tableId: 'table-1' } }).db, matchId: 'x' }), /assign a schedule and table/i);
  await assert.rejects(() => ops.startTournamentMatch({ db: makeDb({ match: { status: 'BYE', tableId: 'table-1' } }).db, matchId: 'x' }), /not operationally editable/);
});

test('releases only the completed match table when no other live tournament match owns it', async () => {
  const released = makeDb({ match: { tableId: 'table-1', status: 'COMPLETED' } });
  assert.equal(await ops.releaseTournamentMatchTable({ db: released.db, match: released.stored }), 'table-1');
  assert.equal(released.calls.tableUpdates, 1);
  const owned = makeDb({ match: { tableId: 'table-1' }, other: { id: 'other', status: 'IN_PROGRESS' } });
  assert.equal(await ops.releaseTournamentMatchTable({ db: owned.db, match: owned.stored }), null);
  assert.equal(owned.calls.tableUpdates, 0);
});
