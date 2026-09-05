const express = require('express');
const router = express.Router();
const {
  createTournament,
  closeRegistration,
  scheduleMatch,
  assignMatchTable,
  setupMatch,
  startMatch,
  markPrizePaid,
  registerForTournament,
  getCancellationQuote,
  cancelMyEntry,
  settleCancellationFee,
  approveEntry,
  cancelEntry,
  generateBrackets,
  reportMatchResult,
  getTournament,
  listTournaments,
  listPendingEntries,
  listMyPendingCancellationFees,
} = require('../controllers/tournament.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

const playerParticipationOnly = (req, res, next) => {
  if (req.user?.role !== 'MEMBER') {
    return res.status(403).json({ error: 'Tournament participation is available only for Player accounts.', code: 'TOURNAMENT_PARTICIPATION_PLAYER_ONLY' });
  }
  next();
};

// Public / member
router.get('/', authenticate, listTournaments);
router.get('/cancellation-fees/mine', authenticate, playerParticipationOnly, listMyPendingCancellationFees);
router.get('/:tournamentId', authenticate, getTournament);

// Member: register (shows cancellation warning on the mobile side before calling this)
router.post('/:tournamentId/register', authenticate, playerParticipationOnly, registerForTournament);
router.get('/:tournamentId/cancellation-quote', authenticate, playerParticipationOnly, getCancellationQuote);
router.post('/:tournamentId/cancel', authenticate, playerParticipationOnly, cancelMyEntry);

// Admin: create, manage entries, generate brackets
router.post('/', authenticate, requireRole('ADMIN'), createTournament);
router.post('/:tournamentId/close-registration', authenticate, requireRole('ADMIN'), closeRegistration);
router.post('/:tournamentId/payout/mark-paid', authenticate, requireRole('ADMIN'), markPrizePaid);
router.get('/:tournamentId/pending-entries', authenticate, requireRole('ADMIN'), listPendingEntries);
router.patch('/entries/:entryId/approve', authenticate, requireRole('ADMIN'), approveEntry);
router.patch('/entries/:entryId/cancel', authenticate, requireRole('ADMIN'), cancelEntry);
router.patch('/entries/:entryId/settle-cancellation-fee', authenticate, requireRole('ADMIN', 'STAFF'), settleCancellationFee);
router.post('/:tournamentId/brackets', authenticate, requireRole('ADMIN'), generateBrackets);
router.patch('/matches/:matchId/schedule', authenticate, requireRole('STAFF'), scheduleMatch);
router.patch('/matches/:matchId/table', authenticate, requireRole('STAFF'), assignMatchTable);
router.patch('/matches/:matchId/setup', authenticate, requireRole('STAFF'), setupMatch);
router.post('/matches/:matchId/start', authenticate, requireRole('STAFF'), startMatch);

// Staff: report operational match results. Admin retains read/configuration access.
router.patch(
  '/matches/:matchId/result',
  authenticate,
  requireRole('STAFF'),
  reportMatchResult
);

module.exports = router;
