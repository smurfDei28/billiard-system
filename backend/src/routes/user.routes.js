// user.routes.js - User profile management
const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { PH_PHONE_PATTERN, normalizeOptionalPhone } = require('../utils/phone');

router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { membership: true, gamifiedProfile: true, loyaltyHistory: { take: 10, orderBy: { createdAt: 'desc' } } },
    });
    const { password, ...safe } = user;
    res.json(safe);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch profile' }); }
});

router.patch('/profile', authenticate, async (req, res) => {
  const { firstName, lastName, phone, pushToken, avatarUrl } = req.body;
  const phoneProvided = Object.prototype.hasOwnProperty.call(req.body, 'phone');
  const normalizedPhone = normalizeOptionalPhone(phone);
  if (phoneProvided && normalizedPhone && !PH_PHONE_PATTERN.test(normalizedPhone)) {
    return res.status(400).json({ error: 'Must be a valid Philippine phone number (e.g. 09171234567)' });
  }
  try {
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { firstName, lastName, phone: phoneProvided ? normalizedPhone : undefined, pushToken, avatarUrl },
    });
    const { password, ...safe } = updated;
    res.json(safe);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Phone number is already registered' });
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Read-only public player profile. Deliberately excludes contact details,
// credits, reservations, payments, and all administrative account data.
router.get('/public/:userId', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: {
        id: true, firstName: true, lastName: true, avatarUrl: true, createdAt: true,
        membership: { select: { status: true, plan: true } },
        gamifiedProfile: { select: { displayName: true, level: true, rank: true, totalWins: true, totalLosses: true, totalGames: true, badges: true } },
        championTitles: { select: { tournamentName: true, format: true, earnedAt: true }, orderBy: { earnedAt: 'desc' } },
        _count: { select: { tournamentEntries: true } },
      },
    });
    if (!user) return res.status(404).json({ error: 'Player not found.' });
    const tournamentWins = await prisma.tournamentEntry.count({ where: { userId: user.id, status: 'WINNER' } });
    res.json({ ...user, tournamentWins, tournamentsJoined: user._count.tournamentEntries });
  } catch (err) {
    console.error('[Public Player Profile Error]', err);
    res.status(500).json({ error: 'Could not load this player profile.' });
  }
});

router.get('/', authenticate, authorize('ADMIN', 'STAFF'), async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isEmailVerified: true, membership: true, gamifiedProfile: true, createdAt: true },
  });
  res.json(users);
});

// Staff/Admin: search members (typeahead)
// Supports searching by username (gamifiedProfile.displayName), name, email, or phone.
router.get('/search', authenticate, authorize('ADMIN', 'STAFF'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  const role = String(req.query.role || 'MEMBER');

  if (!q) return res.json([]);

  try {
    const users = await prisma.user.findMany({
      where: {
        role,
        OR: [
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { firstName: { startsWith: q, mode: 'insensitive' } },
          { lastName: { startsWith: q, mode: 'insensitive' } },
          { gamifiedProfile: { is: { displayName: { startsWith: q, mode: 'insensitive' } } } },
        ],
      },
      take: 10,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        membership: { select: { creditBalance: true, plan: true, status: true } },
        gamifiedProfile: { select: { displayName: true, rank: true } },
      },
    });

    res.json(users);
  } catch (err) {
    console.error('[User Search Error]', err);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

module.exports = router;



