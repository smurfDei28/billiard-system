const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const readMobile = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', ...parts), 'utf8');

test('retired legacy queue entries cannot create a stuck waiting count', () => {
  const tableController = read('src', 'controllers', 'table.controller.js');
  const migration = read('prisma', 'migrations', '20260905020000_retire_legacy_queue', 'migration.sql');

  assert.doesNotMatch(tableController, /queue:\s*\{\s*where:\s*\{\s*status/);
  assert.match(tableController, /return \{ \.\.\.table, queue: \[\], currentReservation, nextReservation \}/);
  assert.match(migration, /UPDATE "queue_entries"/);
  assert.match(migration, /WHERE "status" IN \('WAITING', 'CALLED'\)/);
});

test('shop filters keep the category strip compact and the empty state stable', () => {
  const shop = readMobile('src', 'screens', 'member', 'ShopScreen.tsx');

  assert.match(shop, /style=\{s\.categoryScroller\}/);
  assert.match(shop, /categoryScroller:\s*\{[^}]*flexGrow:\s*0[^}]*height:\s*56/);
  assert.match(shop, /filtered\.length === 0 && s\.emptyList/);
});

test('long member histories are collapsed behind explicit controls', () => {
  const profile = readMobile('src', 'screens', 'member', 'ProfileScreen.tsx');
  const payments = readMobile('src', 'screens', 'member', 'ManualPaymentScreen.tsx');

  assert.match(profile, /transactions\.slice\(0, 5\)/);
  assert.match(profile, /showAllHistory \? 'See Less' : `See More/);
  assert.match(payments, /pendingShopPayments\.slice\(0, 3\)/);
  assert.match(payments, /showAllPendingShopPayments[\s\S]*"See Less"[\s\S]*`See More/);
});
