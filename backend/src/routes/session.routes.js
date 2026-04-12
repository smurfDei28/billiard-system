const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Get all active sessions
router.get('/', authenticate, authorize('STAFF', 'ADMIN'), async (req, res) => {
  try {
    const sessions = await prisma.tableSession.findMany({
      where: { status: 'ACTIVE' },
      include: {
        table: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true, membership: true } },
      },
      orderBy: { startTime: 'asc' },
    });
    res.json(sessions);
  } catch { res.status(500).json({ error: 'Failed to fetch sessions' }); }
});

// Get session by ID
router.get('/:sessionId', authenticate, async (req, res) => {
  try {
    const session = await prisma.tableSession.findUnique({
      where: { id: req.params.sessionId },
      include: { table: true, user: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch { res.status(500).json({ error: 'Failed to fetch session' }); }
});

// Extend session - add more credits/time
router.post('/:sessionId/extend', authenticate, authorize('STAFF', 'ADMIN'), async (req, res) => {
  const { minutes = 60 } = req.body;
  try {
    const session = await prisma.tableSession.findUnique({
      where: { id: req.params.sessionId },
      include: { table: true, user: { select: { id: true, membership: true } } },
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'ACTIVE') return res.status(400).json({ error: 'Session is not active' });

    const creditsNeeded = Math.round((session.table.ratePerHour / 60) * minutes);

    // Check if member has enough credits
    if (session.userId && session.user?.membership) {
      if (session.user.membership.creditBalance < creditsNeeded) {
        return res.status(400).json({
          error: `Insufficient credits. Need ${creditsNeeded}, have ${session.user.membership.creditBalance}`
        });
      }
      // Deduct credits for extension
      await prisma.membership.update({
        where: { userId: session.userId },
        data: { creditBalance: { decrement: creditsNeeded } },
      });
    }

    // Update session
    const updated = await prisma.tableSession.update({
      where: { id: req.params.sessionId },
      data: { creditsUsed: { increment: creditsNeeded } },
      include: { table: true },
    });

    // Notify via socket
    const io = req.app.get('io');
    io.to('staff-tablet').emit('session:extended', { sessionId: session.id, minutes, creditsUsed: creditsNeeded });

    res.json({ message: `Extended by ${minutes} minutes`, creditsUsed: creditsNeeded, session: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to extend session' });
  }
});

// Get session history for a user
router.get('/user/:userId', authenticate, async (req, res) => {
  try {
    const sessions = await prisma.tableSession.findMany({
      where: { userId: req.params.userId },
      include: { table: true },
      orderBy: { startTime: 'desc' },
      take: 20,
    });
    res.json(sessions);
  } catch { res.status(500).json({ error: 'Failed to fetch session history' }); }
});

module.exports = router;
