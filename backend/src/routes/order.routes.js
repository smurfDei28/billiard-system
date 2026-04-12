const express = require('express');
const router = express.Router();
const { createOrder, getOrders } = require('../controllers/pos.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/', authenticate, authorize('STAFF', 'ADMIN'), getOrders);
router.post('/', authenticate, authorize('STAFF', 'ADMIN'), createOrder);

module.exports = router;
