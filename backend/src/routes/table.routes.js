const express = require('express');
const router = express.Router();
const { getAllTables, startSession, endSession, extendSession, updateTableStatus } = require('../controllers/table.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/', authenticate, getAllTables);
router.post('/:tableId/session/start', authenticate, authorize('STAFF', 'ADMIN'), startSession);
router.patch('/session/:sessionId/end', authenticate, authorize('STAFF', 'ADMIN'), endSession);
router.patch('/session/:sessionId/extend', authenticate, extendSession);
router.patch('/:tableId/status', authenticate, authorize('STAFF', 'ADMIN'), updateTableStatus);

module.exports = router;
