const assert = require('node:assert/strict');
const test = require('node:test');
const { markTournamentPrizePaid } = require('../src/services/tournamentPayout.service');

const makeDb = ({ status = 'COMPLETED', finalPrizePool = 4000, champion = { userId: 'champion-1' }, payout = null } = {}) => {
  const tournament = { id: 'tournament-1', name: 'Cash Cup', status, finalPrizePool };
  const state = { payout, actions: [], notifications: [], walletTouched: false, creditTransactions: 0 };
  const db = {
    tournament: { findUnique: async () => ({ ...tournament }) },
    championTitle: { findFirst: async () => champion && ({ tournamentId: 'tournament-1', ...champion }) },
    tournamentPayout: {
      findUnique: async () => state.payout && ({ ...state.payout }),
      create: async ({ data }) => {
        state.payout = { id: 'payout-1', ...data };
        return { ...state.payout };
      },
    },
    staffAction: { create: async ({ data }) => { state.actions.push(data); return data; } },
    notification: { createMany: async ({ data }) => { state.notifications.push(...data); return { count: data.length }; } },
    membership: { update: async () => { state.walletTouched = true; } },
    creditTransaction: { create: async () => { state.creditTransactions += 1; } },
  };
  return { db, state, tournament };
};

test('marks the authoritative completed champion cash prize paid without any wallet or revenue transaction', async () => {
  const { db, state, tournament } = makeDb();
  const result = await markTournamentPrizePaid({ db, tournamentId: 'tournament-1', adminId: 'admin-1', note: 'Handed over at counter', amount: 1, recipientId: 'someone-else' });
  assert.equal(result.alreadyPaid, false);
  assert.equal(result.payout.recipientId, 'champion-1');
  assert.equal(result.payout.amount, 4000);
  assert.equal(result.payout.method, 'CASH');
  assert.equal(result.payout.status, 'PAID');
  assert.ok(result.payout.paidAt);
  assert.equal(result.payout.paidById, 'admin-1');
  assert.equal(state.walletTouched, false);
  assert.equal(state.creditTransactions, 0);
  assert.equal(tournament.finalPrizePool, 4000);
  assert.equal(state.actions.length, 1);
  assert.equal(state.actions[0].action, 'TOURNAMENT_PRIZE_PAID_CASH');
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].userId, 'champion-1');
  assert.match(state.notifications[0].message, /cash prize has been recorded as paid/);
});

test('rejects payout when the tournament is not completed', async () => {
  const { db, state } = makeDb({ status: 'IN_PROGRESS' });
  await assert.rejects(() => markTournamentPrizePaid({ db, tournamentId: 'tournament-1', adminId: 'admin-1' }), /Only completed/);
  assert.equal(state.payout, null);
});

test('rejects a completed tournament with no persisted champion', async () => {
  const { db, state } = makeDb({ champion: null });
  await assert.rejects(() => markTournamentPrizePaid({ db, tournamentId: 'tournament-1', adminId: 'admin-1' }), /champion has not been recorded/);
  assert.equal(state.payout, null);
});

test('rejects zero or missing finalized prize pools', async () => {
  for (const finalPrizePool of [0, null]) {
    const { db, state } = makeDb({ finalPrizePool });
    await assert.rejects(() => markTournamentPrizePaid({ db, tournamentId: 'tournament-1', adminId: 'admin-1' }), /no finalized prize pool/);
    assert.equal(state.payout, null);
  }
});

test('is idempotent after the cash prize has already been recorded', async () => {
  const existing = { id: 'payout-1', tournamentId: 'tournament-1', recipientId: 'champion-1', amount: 4000, method: 'CASH', status: 'PAID', paidAt: new Date('2026-08-08T10:00:00Z') };
  const { db, state } = makeDb({ payout: existing });
  const result = await markTournamentPrizePaid({ db, tournamentId: 'tournament-1', adminId: 'admin-2' });
  assert.equal(result.alreadyPaid, true);
  assert.deepEqual(result.payout, existing);
  assert.equal(state.actions.length, 0);
  assert.equal(state.notifications.length, 0);
});
