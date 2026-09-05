const assert = require('node:assert/strict');
const test = require('node:test');
const { hasValidPassword, passwordPolicyMessage } = require('../src/utils/passwordPolicy');

test('password policy accepts valid passwords with different special characters', () => {
  assert.equal(hasValidPassword('Password1!'), true);
  assert.equal(hasValidPassword('Another9_'), true);
});

test('password policy rejects passwords missing a required character class', () => {
  for (const password of ['Password1', 'Password!', 'password1!', 'PASSWORD1!', 'Pa1!']) {
    assert.equal(hasValidPassword(password), false, password);
  }
  assert.match(passwordPolicyMessage, /special character/);
});
