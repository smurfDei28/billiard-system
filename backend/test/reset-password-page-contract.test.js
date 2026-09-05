const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'auth.controller.js'), 'utf8');

test('reset page uses a native POST form with token, password, confirmation, and a submit button', () => {
  const page = source.slice(source.indexOf('const renderResetPasswordHtml'), source.indexOf('const resetPasswordPage'));
  assert.match(page, /<form method="POST" action="\/api\/auth\/reset-password"/);
  assert.match(page, /name="token"/);
  assert.match(page, /name="password"/);
  assert.match(page, /name="confirmPassword"/);
  assert.match(page, /<button type="submit"/);
  assert.match(page, /<script src="\/api\/auth\/reset-password-page\.js" defer><\/script>/);
});

test('reset page script confirms before native submission and visibly prevents repeat taps', () => {
  const page = source.slice(source.indexOf('const resetPasswordPageScript'), source.indexOf('const resetPasswordPage ='));
  assert.match(page, /window\.confirm\('Are you sure you want to set this as your new password\?'/);
  assert.match(page, /event\.preventDefault\(\)/);
  assert.match(page, /submitButton\.disabled = true/);
  assert.match(page, /Updating Password\.\.\./);
});

test('reset URL generation validates the configured HTTP(S) public base and logs safe diagnostics', () => {
  const publicUrlHelper = source.slice(source.indexOf('const getPublicBackendUrl'), source.indexOf('const getMobileEmailVerifiedUrl'));
  const resetMail = source.slice(source.indexOf('const sendPasswordResetEmail'), source.indexOf('// â”€â”€â”€ Validation Rules'));
  assert.match(publicUrlHelper, /parsedUrl\.protocol !== 'http:'/);
  assert.match(publicUrlHelper, /parsedUrl\.protocol !== 'https:'/);
  assert.match(resetMail, /\[Forgot Password\]/);
  assert.match(resetMail, /resetBaseUrl/);
  assert.match(resetMail, /\/api\/auth\/reset-password\?token=/);
});

test('development HTTP mode does not send browser HTTPS-upgrade headers, while production keeps Helmet defaults', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(indexSource, /const isProduction = process\.env\.NODE_ENV === 'production';/);
  assert.match(indexSource, /upgradeInsecureRequests: null/);
  assert.match(indexSource, /strictTransportSecurity: false/);
  assert.match(indexSource, /helmet\(isProduction \? \{\} : \{/);
});
