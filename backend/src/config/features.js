const MODULES = Object.freeze([
  'MEMBERSHIP',
  'TABLE_MANAGEMENT',
  'RESERVATIONS',
  'POS_INVENTORY',
  'TOURNAMENTS',
  'CREDITS_PAYMENTS',
  'LOYALTY_REWARDS',
  'NOTIFICATIONS',
  'REPORTS_ANALYTICS',
  'CAMERA_SCORING',
]);

// Customer-facing packages. Dependencies are expanded before the existing
// module guards and mobile navigation consume the entitlement manifest.
const GROUP_DEFINITIONS = Object.freeze({
  CORE_OPERATIONS: Object.freeze({
    modules: Object.freeze(['MEMBERSHIP', 'TABLE_MANAGEMENT', 'RESERVATIONS', 'NOTIFICATIONS']),
    dependencies: Object.freeze([]),
  }),
  COMMERCE: Object.freeze({
    modules: Object.freeze(['POS_INVENTORY', 'CREDITS_PAYMENTS']),
    dependencies: Object.freeze(['CORE_OPERATIONS']),
  }),
  TOURNAMENTS_LOYALTY: Object.freeze({
    modules: Object.freeze(['TOURNAMENTS', 'LOYALTY_REWARDS']),
    dependencies: Object.freeze(['CORE_OPERATIONS', 'COMMERCE']),
  }),
  BUSINESS_ANALYTICS: Object.freeze({
    modules: Object.freeze(['REPORTS_ANALYTICS']),
    dependencies: Object.freeze([]),
  }),
  VISION_SCORING: Object.freeze({
    modules: Object.freeze(['CAMERA_SCORING']),
    dependencies: Object.freeze(['CORE_OPERATIONS']),
  }),
});

const GROUPS = Object.freeze(Object.keys(GROUP_DEFINITIONS));
const normalizeList = (raw) => [...new Set(String(raw).split(',').map((value) => value.trim().toUpperCase()).filter(Boolean))];

const parseEnabledModules = (raw = process.env.ENABLED_MODULES) => {
  if (!raw || String(raw).trim().toUpperCase() === 'ALL') return [...MODULES];
  const requested = normalizeList(raw);
  const invalid = requested.filter((value) => !MODULES.includes(value));
  if (invalid.length) throw new Error(`Unknown ENABLED_MODULES value(s): ${invalid.join(', ')}`);
  return requested;
};

const parseEnabledGroups = (raw = process.env.ENABLED_GROUPS) => {
  if (!raw || String(raw).trim().toUpperCase() === 'ALL') return [...GROUPS];
  const requested = normalizeList(raw);
  const invalid = requested.filter((value) => !GROUPS.includes(value));
  if (invalid.length) throw new Error(`Unknown ENABLED_GROUPS value(s): ${invalid.join(', ')}`);
  return requested;
};

const expandGroups = (requestedGroups) => {
  const expandedGroups = new Set();
  const visit = (groupName) => {
    if (expandedGroups.has(groupName)) return;
    GROUP_DEFINITIONS[groupName].dependencies.forEach(visit);
    expandedGroups.add(groupName);
  };
  requestedGroups.forEach(visit);

  const moduleSet = new Set();
  expandedGroups.forEach((groupName) => GROUP_DEFINITIONS[groupName].modules.forEach((moduleName) => moduleSet.add(moduleName)));
  return {
    enabledGroups: GROUPS.filter((groupName) => expandedGroups.has(groupName)),
    enabledModules: MODULES.filter((moduleName) => moduleSet.has(moduleName)),
  };
};

const resolveFeatureConfiguration = ({ groupsRaw = process.env.ENABLED_GROUPS, modulesRaw = process.env.ENABLED_MODULES } = {}) => {
  if (groupsRaw && String(groupsRaw).trim()) {
    return { ...expandGroups(parseEnabledGroups(groupsRaw)), configurationMode: 'GROUPS' };
  }
  return {
    enabledGroups: [],
    enabledModules: parseEnabledModules(modulesRaw),
    configurationMode: 'LEGACY_MODULES',
  };
};

const featureConfiguration = resolveFeatureConfiguration();
const { enabledGroups, enabledModules, configurationMode } = featureConfiguration;
const isFeatureEnabled = (moduleName) => enabledModules.includes(moduleName);

const requireFeature = (moduleName) => (req, res, next) => {
  if (!MODULES.includes(moduleName)) return next(new Error(`Unknown module guard: ${moduleName}`));
  if (!isFeatureEnabled(moduleName)) {
    return res.status(403).json({
      error: 'Module is not included in this installation',
      code: 'MODULE_NOT_ENTITLED',
      module: moduleName,
    });
  }
  next();
};

module.exports = {
  MODULES,
  GROUPS,
  GROUP_DEFINITIONS,
  enabledGroups,
  enabledModules,
  configurationMode,
  parseEnabledModules,
  parseEnabledGroups,
  expandGroups,
  resolveFeatureConfiguration,
  isFeatureEnabled,
  requireFeature,
};
