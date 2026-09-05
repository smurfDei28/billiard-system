const express = require('express');
const router = express.Router();
const { getProducts, createProduct, updateProduct, setProductActive, updateStock, getInventoryReport, getStockMovements } = require('../controllers/pos.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/', authenticate, getProducts);
router.get('/inventory', authenticate, authorize('STAFF', 'ADMIN'), getInventoryReport);
router.get('/inventory/movements', authenticate, authorize('STAFF', 'ADMIN'), getStockMovements);
router.post('/', authenticate, authorize('STAFF', 'ADMIN'), createProduct);
router.patch('/:productId', authenticate, authorize('STAFF', 'ADMIN'), updateProduct);
router.patch('/:productId/active', authenticate, authorize('STAFF', 'ADMIN'), setProductActive);
router.patch('/:productId/stock', authenticate, authorize('STAFF', 'ADMIN'), updateStock);

module.exports = router;
