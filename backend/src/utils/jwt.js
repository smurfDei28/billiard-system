const jwt = require('jsonwebtoken');

const parseDurationToMs = (value) => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+)\s*([smhd])$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return Number.isFinite(amount) ? amount * unitMs : null;
};

const getRefreshTokenExpiry = (role) => {
  // Privileged accounts should not auto-logout quickly; keep the default long.
  return ['ADMIN', 'STAFF'].includes(role)
    ? (process.env.JWT_REFRESH_EXPIRES_IN_PRIVILEGED || '30d')
    : (process.env.JWT_REFRESH_EXPIRES_IN || '7d');
};

const getRefreshTokenExpiresAt = (role) => {
  const refreshExpiry = getRefreshTokenExpiry(role);
  const ms = parseDurationToMs(refreshExpiry) ?? 7 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
};

const generateTokens = (userId, role) => {
  const refreshExpiry = getRefreshTokenExpiry(role);

  const accessToken = jwt.sign(
    { userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );

  const refreshToken = jwt.sign(
    { userId, role },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: refreshExpiry }
  );

  return { accessToken, refreshToken };
};

const verifyAccessToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
};

module.exports = {
  generateTokens,
  verifyAccessToken,
  verifyRefreshToken,
  parseDurationToMs,
  getRefreshTokenExpiry,
  getRefreshTokenExpiresAt,
};