const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'member-order.routes.js'), 'utf8');

test('cash collection keeps shared order finalization atomic with a scoped transaction timeout', () => {
  assert.match(source, /finalizePendingMemberOrder\(tx, \{ orderId: req\.params\.orderId, staffId: req\.user\.id \}\)/);
  assert.match(source, /maxWait: 10000, timeout: 20000/);
});
