const express = require('express');
const multer = require('multer');
const router = express.Router();
const { getProducts, createProduct, updateProduct, updateProductImage, setProductActive, updateStock, getInventoryReport, getStockMovements } = require('../controllers/pos.controller');
const { MAX_IMAGE_BYTES, MIME_EXTENSIONS } = require('../services/productImageStorage.service');
const { authenticate, authorize } = require('../middleware/auth.middleware');

const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, Boolean(MIME_EXTENSIONS[file.mimetype])),
});

router.get('/', authenticate, getProducts);
router.get('/inventory', authenticate, authorize('STAFF', 'ADMIN'), getInventoryReport);
router.get('/inventory/movements', authenticate, authorize('STAFF', 'ADMIN'), getStockMovements);
router.post('/', authenticate, authorize('STAFF', 'ADMIN'), createProduct);
router.patch('/:productId', authenticate, authorize('STAFF', 'ADMIN'), updateProduct);
router.post('/:productId/image', authenticate, authorize('STAFF', 'ADMIN'), productImageUpload.single('image'), updateProductImage);
router.patch('/:productId/active', authenticate, authorize('STAFF', 'ADMIN'), setProductActive);
router.patch('/:productId/stock', authenticate, authorize('STAFF', 'ADMIN'), updateStock);

router.use((err, _req, res, next) => {
  if (!(err instanceof multer.MulterError)) return next(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Product images must be 5 MB or smaller.' });
  res.status(400).json({ error: 'The product image upload was invalid.' });
});

module.exports = router;
