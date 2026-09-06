const assert = require('node:assert/strict');
const test = require('node:test');

const { rankForXp, levelForXp, rankProgressForXp, badgesForProfile, presentGamifiedProfile } = require('../src/utils/gamification');

test('XP rank boundaries resolve historical profiles directly without over-100% progress', () => {
  assert.equal(rankForXp(499), 'Hustler');
  assert.equal(rankForXp(500), 'Shark');
  assert.equal(rankForXp(675), 'Shark');
  assert.deepEqual(rankProgressForXp(350), {
    current: { name: 'Hustler', minXp: 200 }, next: { name: 'Shark', minXp: 500 }, progress: 0.5,
  });
  assert.deepEqual(rankProgressForXp(675), {
    current: { name: 'Shark', minXp: 500 }, next: { name: 'Legend', minXp: 1000 }, progress: 0.35,
  });
  assert.equal(rankProgressForXp(9000).progress, 1);
});

test('XP level boundaries stay synchronized with the five rank tiers', () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(199), 1);
  assert.equal(levelForXp(200), 2);
  assert.equal(levelForXp(499), 2);
  assert.equal(levelForXp(500), 3);
  assert.equal(levelForXp(999), 3);
  assert.equal(levelForXp(1000), 4);
  assert.equal(levelForXp(1999), 4);
  assert.equal(levelForXp(2000), 5);
  assert.equal(levelForXp(9000), 5);
});

test('First Win derives from an authoritative recorded match win and First Tournament Win requires a championship', () => {
  assert.deepEqual(badgesForProfile({ totalWins: 0, badges: [] }), []);
  assert.deepEqual(badgesForProfile({ totalWins: 1, badges: [] }), ['first_win']);
  assert.deepEqual(badgesForProfile({ totalWins: 1, badges: ['first_win'] }), ['first_win']);
  assert.deepEqual(badgesForProfile({ totalWins: 3, badges: ['first_win'] }, false), ['first_win']);
  assert.deepEqual(badgesForProfile({ totalWins: 3, badges: ['first_win'] }, true), ['first_win', 'first_tournament_win']);
  assert.deepEqual(presentGamifiedProfile({ xp: 675, totalWins: 2, badges: [] }, true), {
    xp: 675, totalWins: 2, badges: ['first_win', 'first_tournament_win'], rank: 'Shark', level: 3,
  });
});
