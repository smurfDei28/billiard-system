const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const backendSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
const homeSource = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'screens', 'member', 'MemberHomeScreen.tsx'), 'utf8');
const authSource = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'context', 'AuthContext.tsx'), 'utf8');
const shopSource = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'screens', 'member', 'ShopScreen.tsx'), 'utf8');

test('login brute-force protection is scoped to login while the general API limiter remains active', () => {
  assert.match(backendSource, /app\.use\('\/api', limiter\)/);
  assert.match(backendSource, /max: 200/);
  assert.match(backendSource, /app\.use\('\/api\/auth\/login', loginLimiter\)/);
  assert.match(backendSource, /max: 20/);
  assert.doesNotMatch(backendSource, /app\.use\('\/api\/auth', authLimiter/);
  assert.match(backendSource, /limiter: name, method: req\.method, route: `\$\{req\.baseUrl\}\$\{req\.path\}`, retryAfter/);
  assert.match(backendSource, /res\.set\('Retry-After', String\(retryAfter\)\)/);
});

test('one Home refresh is a guarded three-request cycle rather than overlapping duplicate cycles', () => {
  assert.match(homeSource, /refreshInFlight/);
  assert.match(homeSource, /if \(refreshInFlight\.current\) return refreshInFlight\.current/);
  assert.match(homeSource, /api\.get\('\/api\/auth\/me'\)/);
  assert.match(homeSource, /api\.get\('\/api\/notifications'\)/);
  assert.match(homeSource, /api\.get\('\/api\/tables'\)/);
});

test('HTTP 429 is not treated as an authentication failure and Shop displays a temporary-throttling message', () => {
  const interceptor = authSource.slice(authSource.indexOf('api.interceptors.response.use'), authSource.indexOf('interface User'));
  assert.match(interceptor, /error\.response\?\.status === 429/);
  assert.ok(interceptor.indexOf('error.response?.status === 429') < interceptor.indexOf("error.response?.status === 401"));
  assert.match(authSource, /if \(\[401, 403\]\.includes\(error\.response\?\.status\)\)/);
  assert.match(shopSource, /error\.response\?\.status === 429/);
  assert.match(shopSource, /Too many requests/);
});
