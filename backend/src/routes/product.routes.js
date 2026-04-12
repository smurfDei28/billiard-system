const express = require('express');
const router = express.Router();
const { getProducts, createProduct, updateStock, getInventoryReport } = require('../controllers/pos.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/', authenticate, getProducts);
router.get('/inventory', authenticate, authorize('STAFF', 'ADMIN'), getInventoryReport);
router.post('/', authenticate, authorize('ADMIN'), createProduct);
router.patch('/:productId/stock', authenticate, authorize('STAFF', 'ADMIN'), updateStock);

module.exports = router;
