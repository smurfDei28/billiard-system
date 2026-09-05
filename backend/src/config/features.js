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

const parseEnabledModules = (raw = process.env.ENABLED_MODULES) => {
  if (!raw || String(raw).trim().toUpperCase() === 'ALL') return [...MODULES];
  const requested = [...new Set(String(raw).split(',').map((value) => value.trim().toUpperCase()).filter(Boolean))];
  const invalid = requested.filter((value) => !MODULES.includes(value));
  if (invalid.length) throw new Error(`Unknown ENABLED_MODULES value(s): ${invalid.join(', ')}`);
  return requested;
};

const enabledModules = parseEnabledModules();
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

module.exports = { MODULES, enabledModules, parseEnabledModules, isFeatureEnabled, requireFeature };

