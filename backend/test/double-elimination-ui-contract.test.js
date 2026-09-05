const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const backend = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const mobile = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', ...parts), 'utf8');

test('manual Double Elimination generation uses the dedicated non-destructive generator', () => {
  const controller = backend('src', 'controllers', 'tournament.controller.js');
  const start = controller.indexOf("} else if (tournament.format === 'DOUBLE_ELIMINATION')", controller.indexOf('const generateBrackets'));
  const end = controller.indexOf("} else if (tournament.format === 'ROUND_ROBIN')", start);
  const doubleBranch = controller.slice(start, end);

  assert.match(doubleBranch, /generateDoubleEliminationBracket/);
  assert.doesNotMatch(doubleBranch, /deleteMany/);
  assert.match(doubleBranch, /Existing brackets are never regenerated automatically/);
});

test('member and admin bracket views distinguish Double Elimination stages and participant states', () => {
  const member = mobile('src', 'screens', 'member', 'TournamentListScreen.tsx');
  const admin = mobile('src', 'screens', 'admin', 'TournamentManagementScreen.tsx');
  const tv = mobile('src', 'screens', 'tv', 'TVDisplayScreen.tsx');

  for (const source of [member, admin, tv]) {
    assert.match(source, /Winners Bracket|WINNERS BRACKET/);
    assert.match(source, /Losers Bracket|LOSERS BRACKET/);
    assert.match(source, /Grand Final|GRAND FINAL/);
    assert.match(source, /Reset Final|RESET FINAL/);
    assert.match(source, /Waiting for previous match/);
  }
  assert.match(member, /match\.status === 'BYE' \? 'Bye' : 'Waiting'/);
  assert.match(admin, /match\.status === 'BYE' \? 'Bye' : 'Waiting'/);
  assert.match(tv, /match\.status === 'BYE' \? 'Bye' : 'Waiting'/);
});

test('registration UI labels phone optional and submits null for a blank value', () => {
  const register = mobile('src', 'screens', 'auth', 'RegisterScreen.tsx');
  const userManagement = mobile('src', 'screens', 'admin', 'UserManagementScreen.tsx');
  const authContext = mobile('src', 'context', 'AuthContext.tsx');

  assert.match(register, /Phone Number \(Optional\)/);
  assert.match(register, /phone: form\.phone\.trim\(\) \|\| null/);
  assert.match(register, /if \(form\.phone\.trim\(\)/);
  assert.match(authContext, /phone: string \| null/);
  assert.match(authContext, /phone\?: string \| null/);
  assert.match(userManagement, /Phone Number \(Optional\)/);
  assert.match(userManagement, /phone: phone\.trim\(\) \|\| null/);
});
