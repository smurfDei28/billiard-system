const express = require('express');
const router = express.Router();
const { getQueue, getTableQueue, callQueueEntry, removeFromQueue } = require('../controllers/queue.controller');
const { authenticate, authorize, optionalAuth } = require('../middleware/auth.middleware');

router.get('/', authenticate, getQueue);
router.get('/table/:tableId', authenticate, getTableQueue);
// QueueEntry records remain readable for compatibility, but new Member queue
// positions are only created through reservations.
router.post('/join', optionalAuth, (req, res) => res.status(410).json({ error: 'Queue positions are reservation-based. Please create a reservation instead.' }));
router.patch('/:entryId/leave', authenticate, (req, res) => res.status(410).json({ error: 'Queue positions are reservation-based. Cancel the related reservation instead.' }));
router.patch('/:entryId/call', authenticate, authorize('STAFF', 'ADMIN'), callQueueEntry);
router.patch('/:entryId/remove', authenticate, authorize('STAFF', 'ADMIN'), removeFromQueue);

module.exports = router;
