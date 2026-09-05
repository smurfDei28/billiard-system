const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BRACKET_STAGES,
  generateDoubleEliminationBracket,
  routingSlot,
} = require('../src/services/doubleEliminationBracket.service');

const makeDb = (existingMatchCount = 0) => {
  const records = new Map();
  let sequence = 0;
  const db = {
    tournamentMatch: {
      count: async () => existingMatchCount,
      create: async ({ data }) => {
        const record = { id: `match-${++sequence}`, ...data };
        records.set(record.id, record);
        return { ...record };
      },
      update: async ({ where: { id }, data }) => {
        const updated = { ...records.get(id), ...data };
        records.set(id, updated);
        return { ...updated };
      },
    },
  };
  return { db, matches: () => [...records.values()].sort((a, b) => a.matchNumber - b.matchNumber) };
};

const players = (count) => Array.from({ length: count }, (_, index) => ({ userId: `player-${index + 1}` }));

test('4-player Double Elimination persists winners, losers, Grand Final, Reset Final, and deterministic feeder slots', async () => {
  const { db, matches } = makeDb();
  const result = await generateDoubleEliminationBracket({ db, tournamentId: 'four-player', players: players(4) });
  const created = matches();

  assert.equal(result.generated, true);
  assert.equal(created.length, 7);
  assert.deepEqual(created.map((match) => [match.matchNumber, match.bracketStage, match.round, match.player1Id, match.player2Id]), [
    [1, BRACKET_STAGES.WINNERS, 1, 'player-1', 'player-2'],
    [2, BRACKET_STAGES.WINNERS, 1, 'player-3', 'player-4'],
    [3, BRACKET_STAGES.WINNERS, 2, null, null],
    [4, BRACKET_STAGES.LOSERS, 1, null, null],
    [5, BRACKET_STAGES.LOSERS, 2, null, null],
    [6, BRACKET_STAGES.GRAND_FINAL, 3, null, null],
    [7, BRACKET_STAGES.RESET_FINAL, 4, null, null],
  ]);
  assert.equal(created[5].isGrandFinal, true);
  assert.equal(created[6].isResetFinal, true);
  assert.equal(created[6].status, 'PENDING');

  const id = (number) => created[number - 1].id;
  assert.deepEqual(created.slice(0, 5).map((match) => [match.nextWinnerMatchId, match.nextLoserMatchId, match.nextMatchId]), [
    [id(3), id(4), id(3)], [id(3), id(4), id(3)], [id(6), id(5), id(6)], [id(5), null, id(5)], [id(6), null, id(6)],
  ]);
  assert.deepEqual([
    routingSlot({ playerCount: 4, sourceMatch: created[0], route: 'winner' }),
    routingSlot({ playerCount: 4, sourceMatch: created[0], route: 'loser' }),
    routingSlot({ playerCount: 4, sourceMatch: created[1], route: 'winner' }),
    routingSlot({ playerCount: 4, sourceMatch: created[1], route: 'loser' }),
    routingSlot({ playerCount: 4, sourceMatch: created[2], route: 'winner' }),
    routingSlot({ playerCount: 4, sourceMatch: created[2], route: 'loser' }),
    routingSlot({ playerCount: 4, sourceMatch: created[3], route: 'winner' }),
    routingSlot({ playerCount: 4, sourceMatch: created[4], route: 'winner' }),
  ], [
    { destinationKey: 'W2-1', slot: 1 }, { destinationKey: 'L1-1', slot: 1 },
    { destinationKey: 'W2-1', slot: 2 }, { destinationKey: 'L1-1', slot: 2 },
    { destinationKey: 'GF-1', slot: 1 }, { destinationKey: 'L2-1', slot: 2 },
    { destinationKey: 'L2-1', slot: 1 }, { destinationKey: 'GF-1', slot: 2 },
  ]);
});

test('8-player Double Elimination persists the full winners-to-losers drop mapping and later feeder slots', async () => {
  const { db, matches } = makeDb();
  const result = await generateDoubleEliminationBracket({ db, tournamentId: 'eight-player', players: players(8) });
  const created = matches();
  const id = (number) => created[number - 1].id;

  assert.equal(result.generated, true);
  assert.equal(created.length, 15);
  assert.deepEqual(created.map((match) => match.bracketStage), [
    'WINNERS', 'WINNERS', 'WINNERS', 'WINNERS', 'WINNERS', 'WINNERS', 'WINNERS',
    'LOSERS', 'LOSERS', 'LOSERS', 'LOSERS', 'LOSERS', 'LOSERS', 'GRAND_FINAL', 'RESET_FINAL',
  ]);
  assert.equal(created[13].isGrandFinal, true);
  assert.equal(created[14].isResetFinal, true);
  assert.deepEqual(created.slice(0, 7).map((match) => [match.nextWinnerMatchId, match.nextLoserMatchId]), [
    [id(5), id(8)], [id(5), id(8)], [id(6), id(9)], [id(6), id(9)],
    [id(7), id(10)], [id(7), id(11)], [id(14), id(13)],
  ]);
  assert.deepEqual(created.slice(7, 13).map((match) => match.nextWinnerMatchId), [id(10), id(11), id(12), id(12), id(13), id(14)]);
  assert.deepEqual([
    routingSlot({ playerCount: 8, sourceMatch: created[0], route: 'loser' }),
    routingSlot({ playerCount: 8, sourceMatch: created[3], route: 'loser' }),
    routingSlot({ playerCount: 8, sourceMatch: created[4], route: 'loser' }),
    routingSlot({ playerCount: 8, sourceMatch: created[5], route: 'loser' }),
    routingSlot({ playerCount: 8, sourceMatch: created[9], route: 'winner' }),
    routingSlot({ playerCount: 8, sourceMatch: created[11], route: 'winner' }),
    routingSlot({ playerCount: 8, sourceMatch: created[12], route: 'winner' }),
  ], [
    { destinationKey: 'L1-1', slot: 1 }, { destinationKey: 'L1-2', slot: 2 },
    { destinationKey: 'L2-1', slot: 2 }, { destinationKey: 'L2-2', slot: 2 },
    { destinationKey: 'L3-1', slot: 1 }, { destinationKey: 'L3-2', slot: 1 }, { destinationKey: 'GF-1', slot: 2 },
  ]);
});

test('Double Elimination does not create a Single Elimination fallback and protects existing brackets', async () => {
  const { db, matches } = makeDb(1);
  const result = await generateDoubleEliminationBracket({ db, tournamentId: 'existing', players: players(4) });
  assert.deepEqual(result, { generated: false, alreadyGenerated: true, reason: 'EXISTING_BRACKET' });
  assert.equal(matches().length, 0);
  assert.equal(typeof db.tournamentMatch.deleteMany, 'undefined');
});

test('Double Elimination rejects unsupported player counts before creating partial matches', async () => {
  const { db, matches } = makeDb();
  const result = await generateDoubleEliminationBracket({ db, tournamentId: 'six-player', players: players(6) });
  assert.deepEqual(result, { generated: false, alreadyGenerated: false, reason: 'DOUBLE_ELIMINATION_REQUIRES_4_OR_8_PLAYERS' });
  assert.equal(matches().length, 0);
});
