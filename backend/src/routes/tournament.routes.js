const express = require('express');
const router = express.Router();
const {
  createTournament,
  registerForTournament,
  approveEntry,
  cancelEntry,
  generateBrackets,
  reportMatchResult,
  getTournament,
  listTournaments,
  listPendingEntries,
} = require('../controllers/tournament.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

// Public / member
router.get('/', authenticate, listTournaments);
router.get('/:tournamentId', authenticate, getTournament);

// Member: register (shows cancellation warning on the mobile side before calling this)
router.post('/:tournamentId/register', authenticate, requireRole('MEMBER'), registerForTournament);

// Admin: create, manage entries, generate brackets
router.post('/', authenticate, requireRole('ADMIN'), createTournament);
router.get('/:tournamentId/pending-entries', authenticate, requireRole('ADMIN'), listPendingEntries);
router.patch('/entries/:entryId/approve', authenticate, requireRole('ADMIN'), approveEntry);
router.patch('/entries/:entryId/cancel', authenticate, requireRole('ADMIN'), cancelEntry);
router.post('/:tournamentId/brackets', authenticate, requireRole('ADMIN'), generateBrackets);

// Staff/Admin: report match results
router.patch(
  '/matches/:matchId/result',
  authenticate,
  requireRole('ADMIN', 'STAFF'),
  reportMatchResult
);

module.exports = router;
