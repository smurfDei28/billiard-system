const assert = require('node:assert/strict');
const test = require('node:test');
const { formatLabel, localTime, notifyTournamentUsers, participantName } = require('../src/services/tournamentNotification.service');

test('formats tournament labels and participant names without exposing raw enums', () => {
  assert.equal(formatLabel('DOUBLE_ELIMINATION'), 'Double Elimination');
  assert.equal(formatLabel('GRAND_FINAL'), 'Grand Final');
  assert.equal(participantName([{ userId: 'p2', user: { gamifiedProfile: { displayName: 'Player Two' } } }], 'p2'), 'Player Two');
  assert.match(localTime('2026-08-10T10:00:00.000Z'), /2026/);
});

test('sends one mutation notification per distinct participant and never emits on an empty recipient set', async () => {
  const sent = [];
  const db = { notification: { createMany: async ({ data }) => { sent.push(...data); return { count: data.length }; } } };
  await notifyTournamentUsers({ db, userIds: ['player-1', 'player-2', 'player-1', null], title: 'Tournament Match Scheduled', message: 'Race To 5', data: { tournamentId: 't-1', matchId: 'm-1' } });
  await notifyTournamentUsers({ db, userIds: [], title: 'Ignored', message: 'Ignored' });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((item) => item.userId).sort(), ['player-1', 'player-2']);
  assert.ok(sent.every((item) => item.type === 'TOURNAMENT_MATCH' && item.data.matchId === 'm-1'));
});
