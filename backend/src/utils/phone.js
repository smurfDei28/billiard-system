const PH_PHONE_PATTERN = /^(\+63|0)[0-9]{10}$/;

const normalizeOptionalPhone = (value) => {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

module.exports = { PH_PHONE_PATTERN, normalizeOptionalPhone };
