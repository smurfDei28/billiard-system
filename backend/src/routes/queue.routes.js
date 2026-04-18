const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { joinQueue, getQueue, getTableQueue, removeFromQueue } = require('../controllers/queue.controller');
const { authenticate, authorize, optionalAuth } = require('../middleware/auth.middleware');

router.get('/', authenticate, authorize('STAFF', 'ADMIN'), getQueue);
router.get('/table/:tableId', authenticate, getTableQueue);
router.get('/available-tables', authenticate, async (req, res) => {
  try {
    const available = await prisma.billiardTable.count({
      where: { status: 'AVAILABLE' },
    });
    res.json({ availableCount: available });
  } catch (err) {
    console.error('[Available Tables Error]', err);
    res.status(500).json({ error: 'Failed to get available tables' });
  }
});
router.post('/join', optionalAuth, joinQueue);
router.patch('/:entryId/remove', authenticate, authorize('STAFF', 'ADMIN'), removeFromQueue);

module.exports = router;
