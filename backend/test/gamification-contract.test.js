const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { rankForXp } = require('../src/utils/gamification');

const sensorSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'sensor.controller.js'), 'utf8');
const resultSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'tournamentMatchResult.service.js'), 'utf8');

test('regular sensor games preserve recorded stats without awarding XP', () => {
  assert.match(sensorSource, /totalWins: \{ increment: 1 \}/);
  assert.match(sensorSource, /totalGames: \{ increment: 1 \}/);
  assert.match(sensorSource, /winStreak: \{ increment: 1 \}/);
  assert.doesNotMatch(sensorSource, /xp:\s*\{\s*increment:/);
});

test('tournament results award 75 XP to winners, 25 XP to played losers, and one 150 XP plus 120-credit champion reward', () => {
  assert.match(resultSource, /const TOURNAMENT_WIN_XP = 75/);
  assert.match(resultSource, /const TOURNAMENT_LOSS_XP = 25/);
  assert.match(resultSource, /const TOURNAMENT_CHAMPION_XP = 150/);
  assert.match(resultSource, /const TOURNAMENT_CHAMPION_CREDITS = 120/);
  assert.match(resultSource, /xp: \{ increment: TOURNAMENT_LOSS_XP \}/);
  assert.match(resultSource, /creditsAwarded: TOURNAMENT_CHAMPION_CREDITS/);
  assert.match(resultSource, /type: 'LOYALTY_REWARD'/);
  assert.match(resultSource, /existingChampion/);
});

test('rank thresholds use the profile XP progression', () => {
  assert.equal(rankForXp(199), 'Rookie');
  assert.equal(rankForXp(200), 'Hustler');
  assert.equal(rankForXp(500), 'Shark');
  assert.equal(rankForXp(1000), 'Legend');
  assert.equal(rankForXp(2000), 'Elite');
});
