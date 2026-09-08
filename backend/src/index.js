require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const { verifyMailConfiguration } = require('./utils/mailer');
const { startReservationScheduler, stopReservationScheduler } = require('./services/reservationScheduler');
const { startSessionMonitor, stopSessionMonitor } = require('./services/sessionMonitor');
const { startTournamentRegistrationScheduler, stopTournamentRegistrationScheduler } = require('./services/tournamentRegistrationScheduler');
const prisma = require('./config/prisma');
const { enabledModules, requireFeature } = require('./config/features');

const app = express();
// Railway terminates HTTPS at its reverse proxy. Trust exactly that first hop so
// Express and express-rate-limit use the real client IP from X-Forwarded-For.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
const server = http.createServer(app);

// Browser clients may be hosted separately from the API. Keep the kiosk origin
// explicit so deploying it never requires opening CORS to every website.
const browserOrigins = [process.env.FRONTEND_URL, process.env.TV_KIOSK_ORIGIN]
  .flatMap((value) => String(value || '').split(','))
  .map((value) => value.trim().replace(/\/$/, ''))
  .filter(Boolean);
const corsOrigin = browserOrigins.length ? browserOrigins : '*';

// ─── Socket.IO for real-time (TV display, live brackets, queue) ───
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
  },
});

// Make io accessible in routes
app.set('io', io);

// ─── Middleware ───
const isProduction = process.env.NODE_ENV === 'production';
app.use(helmet(isProduction ? {} : {
  // The development server intentionally serves plain HTTP on the LAN. Prevent
  // browsers from upgrading a relative reset-form POST to HTTPS on that port.
  contentSecurityPolicy: {
    directives: {
      upgradeInsecureRequests: null,
    },
  },
  strictTransportSecurity: false,
}));
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rate limiting
const rateLimitHandler = (name) => (req, res, _next, options) => {
  const retryAfter = Math.ceil(options.windowMs / 1000);
  console.warn('[RateLimit]', { limiter: name, method: req.method, route: `${req.baseUrl}${req.path}`, retryAfter });
  res.set('Retry-After', String(retryAfter));
  res.status(options.statusCode).json(options.message);
};

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler('api'),
});
app.use('/api', limiter);

// Module Entitlement System (MES): this public manifest lets every client show
// only the modules provisioned for this installation. API guards below remain
// the source of truth, so hidden routes cannot be called directly.
app.get('/api/features', (req, res) => res.json({ enabledModules }));

// Login attempts need stricter brute-force protection. Other authenticated
// auth routes (for example GET /me) are normal API traffic and must not spend
// this login-only budget.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler('login'),
});

// ─── Routes ───
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/membership', requireFeature('MEMBERSHIP'), require('./routes/membership.routes'));
app.use('/api/tables', requireFeature('TABLE_MANAGEMENT'), require('./routes/table.routes'));
app.use('/api/queue', requireFeature('RESERVATIONS'), require('./routes/queue.routes'));
app.use('/api/sessions', requireFeature('TABLE_MANAGEMENT'), require('./routes/session.routes'));
app.use('/api/credits', requireFeature('CREDITS_PAYMENTS'), require('./routes/credit.routes'));
app.use('/api/loyalty', requireFeature('LOYALTY_REWARDS'), require('./routes/loyalty.routes'));
app.use('/api/products', requireFeature('POS_INVENTORY'), require('./routes/product.routes'));
app.use('/api/orders', requireFeature('POS_INVENTORY'), require('./routes/order.routes'));
app.use('/api/member-orders', requireFeature('POS_INVENTORY'), require('./routes/member-order.routes'));
app.use('/api/tournaments', requireFeature('TOURNAMENTS'), require('./routes/tournament.routes'));
app.use('/api/sensor', requireFeature('CAMERA_SCORING'), require('./routes/sensor.routes'));
app.use('/api/notifications', requireFeature('NOTIFICATIONS'), require('./routes/notification.routes'));
app.use('/api/analytics', requireFeature('REPORTS_ANALYTICS'), require('./routes/analytics.routes'));
app.use('/api/payments', requireFeature('CREDITS_PAYMENTS'), require('./routes/payment.routes'));
app.use('/api/staff', require('./routes/staff.routes'));
app.use('/api/reservations', requireFeature('RESERVATIONS'), require('./routes/reservation.route'));


// ─── Health check ───
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ─── 404 handler ───
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Global error handler ───
app.use((err, req, res, next) => {
  console.error('[Error]', err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ─── Socket.IO events ───
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Join rooms for targeted broadcasts
  socket.on('join:table', (tableId) => socket.join(`table:${tableId}`));
  socket.on('join:tournament', (tournamentId) => socket.join(`tournament:${tournamentId}`));
  socket.on('join:tv', () => socket.join('tv-display'));
  socket.on('join:staff', () => socket.join('staff-tablet'));

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// ─── Start server ───
const PORT = process.env.PORT || 3000;
let reservationScheduler;
let sessionMonitor;
server.listen(PORT, () => {
  reservationScheduler = startReservationScheduler(io);
  sessionMonitor = startSessionMonitor(io);
  startTournamentRegistrationScheduler();
  verifyMailConfiguration().catch((err) => {
    console.error('[Mail] SMTP verification failed at startup', {
      code: err.code || err.name,
      message: err.message,
      responseCode: err.responseCode,
    });
  });
  console.log(`\n🎱 Billiard Hall API running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
});

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] ${signal} received; closing database connections.`);
  stopReservationScheduler(reservationScheduler);
  stopSessionMonitor(sessionMonitor);
  stopTournamentRegistrationScheduler();
  io.close();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, io };
