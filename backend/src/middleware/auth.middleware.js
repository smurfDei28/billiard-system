const { verifyAccessToken } = require('../utils/jwt');
const prisma = require('../config/prisma');

// Verify JWT and attach user to request
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true, email: true, role: true,
        firstName: true, lastName: true,
        membership: { select: { status: true, creditBalance: true, plan: true } },
      },
    });

    if (!user) return res.status(401).json({ error: 'User not found' });

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Role-based access control
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
    }
    next();
  };
};

// Optional auth - attach user if token present, continue either way
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = verifyAccessToken(token);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, email: true, role: true, firstName: true, lastName: true },
      });
      req.user = user;
    }
  } catch (_) {}
  next();
};

// Sensor auth - special key for Raspberry Pi
const authenticateSensor = (req, res, next) => {
  const sensorKey = req.headers['x-sensor-key'];
  if (!sensorKey || sensorKey !== process.env.SENSOR_API_KEY) {
    return res.status(401).json({ error: 'Invalid sensor key' });
  }
  next();
};

module.exports = { authenticate, authorize, optionalAuth, authenticateSensor };
