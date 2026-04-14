require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);

// ─── Socket.IO for real-time (TV display, live brackets, queue) ───
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
  },
});

// Make io accessible in routes
app.set('io', io);

// ─── Middleware ───
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', limiter);

// Auth routes get stricter rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts, please try again later.' },
});

// ─── Routes ───
app.use('/api/auth', authLimiter, require('./routes/auth.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/membership', require('./routes/membership.routes'));
app.use('/api/tables', require('./routes/table.routes'));
app.use('/api/queue', require('./routes/queue.routes'));
app.use('/api/sessions', require('./routes/session.routes'));
app.use('/api/credits', require('./routes/credit.routes'));
app.use('/api/loyalty', require('./routes/loyalty.routes'));
app.use('/api/products', require('./routes/product.routes'));
app.use('/api/orders', require('./routes/order.routes'));
app.use('/api/tournaments', require('./routes/tournament.routes'));
app.use('/api/sensor', require('./routes/sensor.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
app.use('/api/analytics', require('./routes/analytics.routes'));
app.use('/api/payments', require('./routes/payment.routes'));
app.use('/api/staff', require('./routes/staff.routes'));
app.use('/api/reservations', require('./routes/reservation.routes'));


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
server.listen(PORT, () => {
  console.log(`\n🎱 Billiard Hall API running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
});

module.exports = { app, io };
