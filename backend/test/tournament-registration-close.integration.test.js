const assert = require('node:assert/strict');
const test = require('node:test');

const { closeTournamentRegistrationWithDb } = require('../src/services/tournamentRegistration.service');

const makeDb = ({ tournament, eligible = [], paidCount = eligible.length, existingMatchCount = 0 }) => {
  const updates = [];
  const db = {
    tournament: {
      findUnique: async () => tournament,
      update: async ({ data }) => {
        updates.push(data);
        return { ...tournament, ...data };
      },
    },
    tournamentEntry: {
      findMany: async () => eligible,
      count: async () => paidCount,
    },
    tournamentMatch: {
      count: async () => existingMatchCount,
    },
  };
  return { db, updates };
};

test('Single Elimination close generates once using the provided transaction client and active eligible entries', async () => {
  const tournament = { id: 'single-1', format: 'SINGLE_ELIMINATION', status: 'REGISTRATION_OPEN', entryFee: 200 };
  const eligible = [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }, { userId: 'd' }];
  const { db, updates } = makeDb({ tournament, eligible, paidCount: 5 });
  const calls = [];

  const result = await closeTournamentRegistrationWithDb({
    db,
    tournamentId: tournament.id,
    generateBracket: async (args) => calls.push(args),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].db, db);
  assert.equal(calls[0].tournamentId, tournament.id);
  assert.deepEqual(calls[0].players.map((player) => player.userId).sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(updates, [{ status: 'REGISTRATION_CLOSED', finalPrizePool: 1000 }]);
  assert.equal(result.bracketPending, false);
  assert.equal(result.bracketGenerated, true);
  assert.equal(result.tournament.status, 'REGISTRATION_CLOSED');
});

test('Single Elimination close preserves existing matches without deleting or regenerating', async () => {
  const tournament = { id: 'single-existing', format: 'SINGLE_ELIMINATION', status: 'REGISTRATION_OPEN', entryFee: 50 };
  const { db } = makeDb({ tournament, eligible: [{ userId: 'a' }, { userId: 'b' }], existingMatchCount: 1 });
  let calls = 0;

  const result = await closeTournamentRegistrationWithDb({ db, tournamentId: tournament.id, generateBracket: async () => { calls += 1; } });

  assert.equal(calls, 0);
  assert.equal(result.bracketGenerated, true);
  assert.equal(result.bracketPending, false);
  assert.equal(typeof db.tournamentMatch.deleteMany, 'undefined');
});

test('Double Elimination close uses its dedicated helper and is no longer bracket-pending after generation', async () => {
  const tournament = { id: 'double-1', format: 'DOUBLE_ELIMINATION', status: 'REGISTRATION_OPEN', entryFee: 50 };
  const eligible = [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }, { userId: 'd' }];
  const { db } = makeDb({ tournament, eligible });
  let singleCalls = 0;
  const doubleCalls = [];

  const result = await closeTournamentRegistrationWithDb({
    db,
    tournamentId: tournament.id,
    generateBracket: async () => { singleCalls += 1; },
    generateDoubleBracket: async (args) => {
      doubleCalls.push(args);
      return { generated: true };
    },
  });

  assert.equal(singleCalls, 0);
  assert.equal(doubleCalls.length, 1);
  assert.equal(doubleCalls[0].db, db);
  assert.deepEqual(doubleCalls[0].players.map((player) => player.userId).sort(), ['a', 'b', 'c', 'd']);
  assert.equal(result.bracketPending, false);
  assert.equal(result.bracketGenerated, true);
});

test('Double Elimination close finalizes safely when the generator rejects an unsupported player count', async () => {
  const tournament = { id: 'double-unsupported', format: 'DOUBLE_ELIMINATION', status: 'REGISTRATION_OPEN', entryFee: 50 };
  const { db, updates } = makeDb({ tournament, eligible: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }] });
  const result = await closeTournamentRegistrationWithDb({
    db,
    tournamentId: tournament.id,
    generateDoubleBracket: async () => ({
      generated: false,
      reason: 'DOUBLE_ELIMINATION_REQUIRES_4_OR_8_PLAYERS',
    }),
  });

  assert.deepEqual(updates, [{ status: 'REGISTRATION_CLOSED', finalPrizePool: 150 }]);
  assert.equal(result.bracketGenerated, false);
  assert.equal(result.bracketPending, true);
  assert.equal(result.bracketReason, 'DOUBLE_ELIMINATION_REQUIRES_4_OR_8_PLAYERS');
});

test('Single Elimination close finalizes safely without a bracket when fewer than two eligible entries remain', async () => {
  const tournament = { id: 'single-insufficient', format: 'SINGLE_ELIMINATION', status: 'REGISTRATION_OPEN', entryFee: 75 };
  const { db, updates } = makeDb({ tournament, eligible: [{ userId: 'a' }], paidCount: 2 });
  let calls = 0;

  const result = await closeTournamentRegistrationWithDb({ db, tournamentId: tournament.id, generateBracket: async () => { calls += 1; } });

  assert.equal(calls, 0);
  assert.deepEqual(updates, [{ status: 'REGISTRATION_CLOSED', finalPrizePool: 150 }]);
  assert.equal(result.bracketGenerated, false);
  assert.equal(result.bracketPending, false);
  assert.equal(result.bracketReason, 'INSUFFICIENT_ELIGIBLE_PARTICIPANTS');
});

test('repeated close is idempotent and does not regenerate a bracket', async () => {
  const tournament = { id: 'single-closed', format: 'SINGLE_ELIMINATION', status: 'REGISTRATION_CLOSED', entryFee: 100 };
  const { db } = makeDb({ tournament });
  let calls = 0;

  const result = await closeTournamentRegistrationWithDb({ db, tournamentId: tournament.id, generateBracket: async () => { calls += 1; } });

  assert.equal(calls, 0);
  assert.equal(result.alreadyClosed, true);
  assert.equal(result.bracketPending, false);
});
