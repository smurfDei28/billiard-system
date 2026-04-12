const express = require('express');
const router = express.Router();
const { joinQueue, getQueue, getTableQueue, removeFromQueue } = require('../controllers/queue.controller');
const { authenticate, authorize, optionalAuth } = require('../middleware/auth.middleware');

router.get('/', authenticate, authorize('STAFF', 'ADMIN'), getQueue);
router.get('/table/:tableId', authenticate, getTableQueue);
router.post('/join', optionalAuth, joinQueue);
router.patch('/:entryId/remove', authenticate, authorize('STAFF', 'ADMIN'), removeFromQueue);

module.exports = router;
