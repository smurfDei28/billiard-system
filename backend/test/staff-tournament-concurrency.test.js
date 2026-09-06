const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const readBackend = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const readMobile = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', ...parts), 'utf8');

test('staff tournament refreshes are coalesced and avoid historical request fan-out', () => {
  const screen = readMobile('src', 'screens', 'staff', 'StaffTournamentOperationsScreen.tsx');

  assert.match(screen, /loadInFlight = useRef<Promise<void> \| null>/);
  assert.match(screen, /if \(loadInFlight\.current\) return loadInFlight\.current/);
  assert.match(screen, /\['REGISTRATION_CLOSED', 'IN_PROGRESS'\]\.includes\(t\.status\)/);
  assert.match(screen, /for \(const tournament of operational\) details\.push\(await api\.get/);
  assert.doesNotMatch(screen, /Promise\.all\(\(tournaments\.data[^;]+api\.get\(`\/api\/tournaments\/\$\{t\.id\}`\)/s);
});

test('match mutations wait safely for a pool slot and return actionable contention errors', () => {
  const controller = readBackend('src', 'controllers', 'tournament.controller.js');

  assert.match(controller, /OPERATION_TRANSACTION_OPTIONS = \{ maxWait: 10000, timeout: 20000 \}/);
  assert.match(controller, /err\.code === 'P2024'[\s\S]*status\(503\)/);
  assert.match(controller, /err\.code === 'P2034'[\s\S]*status\(409\)/);
  assert.equal((controller.match(/OPERATION_TRANSACTION_OPTIONS\)/g) || []).length, 3);
  assert.match(controller, /\{ \.\.\.OPERATION_TRANSACTION_OPTIONS, isolationLevel: 'Serializable' \}/);
});
