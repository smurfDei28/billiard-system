const assert = require('node:assert/strict');
const test = require('node:test');
const { summarizeRevenue, buildDailyRevenue } = require('../src/utils/revenueReporting');

test('cash revenue counts external collections once while retaining wallet usage values', () => {
  const summary = summarizeRevenue({
    topups: [{ amount: 500 }],
    sessions: [{ creditsUsed: 200 }],
    orders: [{ total: 100, paymentMethod: 'CASH', paidWithCredits: false }, { total: 75, paymentMethod: 'LOYALTY_CREDIT', paidWithCredits: true }],
    tournamentPayments: [{ amount: 300 }],
    walletTournamentFees: [{ amount: 50 }],
  });

  assert.equal(summary.cashRevenue, 900); // 500 top-up + 100 cash POS + 300 cash tournament payment
  assert.equal(summary.tableUsageValue, 200);
  assert.equal(summary.posSalesValue, 175);
  assert.equal(summary.cashPosSales, 100);
  assert.equal(summary.creditPosSales, 75);
  assert.equal(summary.walletTournamentFeeValue, 50);
});

test('rewards, unpaid liabilities, and cash prize payouts do not affect report inputs or cash revenue', () => {
  const summary = summarizeRevenue({
    topups: [], orders: [], tournamentPayments: [], sessions: [], walletTournamentFees: [],
  });
  assert.equal(summary.cashRevenue, 0);
  assert.equal(summary.tableUsageValue, 0);
  assert.equal(summary.walletTournamentFeeValue, 0);
});

test('daily report keeps cash collections distinct from credit-funded sales and usage', () => {
  const daily = buildDailyRevenue({
    topups: [{ amount: 500, createdAt: '2026-08-08T01:00:00.000Z' }],
    orders: [{ total: 200, paymentMethod: 'LOYALTY_CREDIT', paidWithCredits: true, createdAt: '2026-08-08T02:00:00.000Z' }],
    sessions: [{ creditsUsed: 200, createdAt: '2026-08-08T03:00:00.000Z' }],
  });
  assert.equal(daily.length, 1);
  assert.equal(daily[0].cashRevenue, 500);
  assert.equal(daily[0].creditPosSales, 200);
  assert.equal(daily[0].tableUsageValue, 200);
});
