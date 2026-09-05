const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'member-order.routes.js'), 'utf8');
const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'memberOrder.service.js'), 'utf8');

test('member Credits checkout uses a scoped protected transaction timeout', () => {
  assert.match(routeSource, /createMemberCreditsOrder\(tx, \{ userId: req\.user\.id, \.\.\.req\.body \}\)/);
  assert.match(routeSource, /maxWait: 10000, timeout: 20000/);
});

test('unexpected member checkout errors are sanitized while stock errors remain safe business messages', () => {
  assert.match(routeSource, /'Could not place order\. Please try again\.'/);
  assert.doesNotMatch(routeSource, /res\.status\(err\.status \|\| 500\)\.json\(\{ error: err\.message/);
  assert.match(serviceSource, /'Some items are out of stock\. Please review your cart\.'/);
});
