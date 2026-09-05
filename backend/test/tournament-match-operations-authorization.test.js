const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('only STAFF can perform tournament match schedule, table, start, and result operations', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/tournament.routes.js'), 'utf8');
  for (const endpoint of [
    "router.patch('/matches/:matchId/schedule', authenticate, requireRole('STAFF'), scheduleMatch);",
    "router.patch('/matches/:matchId/table', authenticate, requireRole('STAFF'), assignMatchTable);",
    "router.post('/matches/:matchId/start', authenticate, requireRole('STAFF'), startMatch);",
    "requireRole('STAFF'),\n  reportMatchResult",
  ]) assert.ok(routes.includes(endpoint), `Expected Staff-only guard for ${endpoint}`);
  assert.equal(routes.includes("requireRole('ADMIN', 'STAFF'), scheduleMatch"), false);
  assert.equal(routes.includes("requireRole('ADMIN', 'STAFF'), assignMatchTable"), false);
  assert.equal(routes.includes("requireRole('ADMIN', 'STAFF'), startMatch"), false);
});
