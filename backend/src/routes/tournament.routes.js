const express = require('express');
const router = express.Router();
const {
  createTournament, registerForTournament, generateBrackets,
  reportMatchResult, getTournament, listTournaments
} = require('../controllers/tournament.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/', authenticate, listTournaments);
router.get('/:tournamentId', authenticate, getTournament);
router.post('/', authenticate, authorize('ADMIN', 'STAFF'), createTournament);
router.post('/:tournamentId/register', authenticate, authorize('MEMBER'), registerForTournament);
router.post('/:tournamentId/brackets', authenticate, authorize('ADMIN', 'STAFF'), generateBrackets);
router.patch('/matches/:matchId/result', authenticate, authorize('ADMIN', 'STAFF'), reportMatchResult);

module.exports = router;
