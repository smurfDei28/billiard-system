const test = require('node:test');
const assert = require('node:assert/strict');

const { MODULES, parseEnabledModules } = require('../src/config/features');

test('MES enables the complete product by default', () => {
  assert.deepEqual(parseEnabledModules('ALL'), MODULES);
  assert.deepEqual(parseEnabledModules(''), MODULES);
});

test('MES accepts a trimmed purchased module package without duplicates', () => {
  assert.deepEqual(
    parseEnabledModules('table_management, CAMERA_SCORING,table_management'),
    ['TABLE_MANAGEMENT', 'CAMERA_SCORING'],
  );
});

test('MES fails fast on a misspelled module instead of silently misconfiguring a buyer', () => {
  assert.throws(() => parseEnabledModules('TABLE_MANAGMENT'), /Unknown ENABLED_MODULES/);
});
