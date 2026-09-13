const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MODULES,
  GROUPS,
  parseEnabledModules,
  parseEnabledGroups,
  expandGroups,
  resolveFeatureConfiguration,
} = require('../src/config/features');

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

test('MES group packages expand their dependencies into the existing module contract', () => {
  assert.deepEqual(expandGroups(parseEnabledGroups('CORE_OPERATIONS')), {
    enabledGroups: ['CORE_OPERATIONS'],
    enabledModules: ['MEMBERSHIP', 'TABLE_MANAGEMENT', 'RESERVATIONS', 'NOTIFICATIONS'],
  });
  assert.deepEqual(expandGroups(parseEnabledGroups('COMMERCE')), {
    enabledGroups: ['CORE_OPERATIONS', 'COMMERCE'],
    enabledModules: ['MEMBERSHIP', 'TABLE_MANAGEMENT', 'RESERVATIONS', 'POS_INVENTORY', 'CREDITS_PAYMENTS', 'NOTIFICATIONS'],
  });
  assert.deepEqual(expandGroups(parseEnabledGroups('VISION_SCORING')), {
    enabledGroups: ['CORE_OPERATIONS', 'VISION_SCORING'],
    enabledModules: ['MEMBERSHIP', 'TABLE_MANAGEMENT', 'RESERVATIONS', 'NOTIFICATIONS', 'CAMERA_SCORING'],
  });
});

test('Tournament and complete packages include every declared dependency once', () => {
  const tournament = expandGroups(parseEnabledGroups('TOURNAMENTS_LOYALTY'));
  assert.deepEqual(tournament.enabledGroups, ['CORE_OPERATIONS', 'COMMERCE', 'TOURNAMENTS_LOYALTY']);
  assert.deepEqual(tournament.enabledModules, MODULES.filter((moduleName) => !['REPORTS_ANALYTICS', 'CAMERA_SCORING'].includes(moduleName)));
  assert.deepEqual(expandGroups(parseEnabledGroups('ALL')), { enabledGroups: GROUPS, enabledModules: MODULES });
});

test('Group configuration takes precedence while legacy module configuration remains compatible', () => {
  assert.deepEqual(resolveFeatureConfiguration({ groupsRaw: 'BUSINESS_ANALYTICS', modulesRaw: 'ALL' }), {
    enabledGroups: ['BUSINESS_ANALYTICS'],
    enabledModules: ['REPORTS_ANALYTICS'],
    configurationMode: 'GROUPS',
  });
  assert.deepEqual(resolveFeatureConfiguration({ groupsRaw: '', modulesRaw: 'TABLE_MANAGEMENT' }), {
    enabledGroups: [],
    enabledModules: ['TABLE_MANAGEMENT'],
    configurationMode: 'LEGACY_MODULES',
  });
  assert.throws(() => parseEnabledGroups('BUSINES_ANALYTICS'), /Unknown ENABLED_GROUPS/);
});
