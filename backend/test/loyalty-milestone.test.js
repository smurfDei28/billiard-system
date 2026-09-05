const assert = require('node:assert/strict');
const test = require('node:test');
const { checkLoyaltyMilestone, LOYALTY_MILESTONE_CREDITS } = require('../src/controllers/table.controller');

const makeDb = ({ totalHoursPlayed = 20, creditBalance = 30, priorAwards = 0 } = {}) => {
  const membership = { totalHoursPlayed, creditBalance };
  const history = Array.from({ length: priorAwards }, () => ({ trigger: 'HOURS_MILESTONE', creditsAwarded: 60 }));
  const notifications = [];
  return {
    membership,
    history,
    notifications,
    db: {
      membership: {
        findUnique: async () => ({ ...membership }),
        update: async ({ data }) => {
          membership.creditBalance += data.creditBalance.increment;
          return { ...membership };
        },
      },
      loyaltyHistory: {
        count: async () => history.filter((entry) => entry.trigger === 'HOURS_MILESTONE').length,
        create: async ({ data }) => { history.push(data); return data; },
      },
      notification: {
        create: async ({ data }) => { notifications.push(data); return data; },
      },
    },
  };
};

test('20-hour loyalty milestone awards 120 credits once with matching history and notification', async () => {
  const fixture = makeDb();
  assert.equal(LOYALTY_MILESTONE_CREDITS, 120);

  await checkLoyaltyMilestone('member-1', fixture.db);
  assert.equal(fixture.membership.creditBalance, 150);
  assert.equal(fixture.history.length, 1);
  assert.equal(fixture.history[0].creditsAwarded, 120);
  assert.match(fixture.history[0].description, /120 credits/);
  assert.equal(fixture.notifications.length, 1);
  assert.equal(fixture.notifications[0].title, '20-Hour Playing Milestone Reached!');
  assert.match(fixture.notifications[0].message, /120.*credits/i);

  await checkLoyaltyMilestone('member-1', fixture.db);
  assert.equal(fixture.membership.creditBalance, 150);
  assert.equal(fixture.history.length, 1);
  assert.equal(fixture.notifications.length, 1);
});

test('milestone does not affect users below 20 hours or rewrite historical awards', async () => {
  const belowThreshold = makeDb({ totalHoursPlayed: 19.9 });
  await checkLoyaltyMilestone('member-1', belowThreshold.db);
  assert.equal(belowThreshold.membership.creditBalance, 30);
  assert.equal(belowThreshold.history.length, 0);

  const historical = makeDb({ totalHoursPlayed: 20, priorAwards: 1 });
  await checkLoyaltyMilestone('member-1', historical.db);
  assert.equal(historical.membership.creditBalance, 30);
  assert.equal(historical.history.length, 1);
  assert.equal(historical.history[0].creditsAwarded, 60);
});

test('every completed 20-hour block grants one reward while the notification remains a 20-hour event', async () => {
  const fixture = makeDb({ totalHoursPlayed: 40, priorAwards: 1 });

  await checkLoyaltyMilestone('member-1', fixture.db);
  assert.equal(fixture.membership.creditBalance, 150);
  assert.equal(fixture.history.length, 2);
  assert.equal(fixture.history[1].creditsAwarded, 120);
  assert.equal(fixture.notifications.length, 1);
  assert.equal(fixture.notifications[0].title, '20-Hour Playing Milestone Reached!');
  assert.match(fixture.notifications[0].message, /20-hour playing milestone/i);

  // Re-evaluation at 40 hours and then 41 hours must not duplicate the reward.
  await checkLoyaltyMilestone('member-1', fixture.db);
  fixture.membership.totalHoursPlayed = 41;
  await checkLoyaltyMilestone('member-1', fixture.db);
  assert.equal(fixture.membership.creditBalance, 150);
  assert.equal(fixture.history.length, 2);
  assert.equal(fixture.notifications.length, 1);
});

test('lifetime milestone counting remains recurring through 60 hours', async () => {
  const fixture = makeDb({ totalHoursPlayed: 60, priorAwards: 2 });

  await checkLoyaltyMilestone('member-1', fixture.db);
  assert.equal(fixture.membership.creditBalance, 150);
  assert.equal(fixture.history.length, 3);
  assert.equal(fixture.history[2].creditsAwarded, 120);
  assert.equal(fixture.notifications.length, 1);
  assert.equal(fixture.notifications[0].title, '20-Hour Playing Milestone Reached!');
});
