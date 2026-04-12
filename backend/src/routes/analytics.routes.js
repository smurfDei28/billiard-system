const express = require('express');
const router = express.Router();
const { getDashboard, getSalesReport } = require('../controllers/analytics.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/dashboard', authenticate, authorize('ADMIN', 'STAFF'), getDashboard);
router.get('/sales', authenticate, authorize('ADMIN', 'STAFF'), getSalesReport);

module.exports = router;
