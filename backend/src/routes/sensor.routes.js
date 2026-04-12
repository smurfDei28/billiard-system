// sensor.routes.js
const express = require('express');
const router = express.Router();
const { pocketDetected, startGame, updateScore, endGame, getLiveData } = require('../controllers/sensor.controller');
const { authenticate, authorize, authenticateSensor } = require('../middleware/auth.middleware');

// Raspberry Pi endpoints (use sensor API key)
router.post('/pocket', authenticateSensor, pocketDetected);

// Staff/Admin endpoints
router.post('/game/start', authenticate, authorize('STAFF', 'ADMIN'), startGame);
router.patch('/game/:sessionId/score', authenticate, authorize('STAFF', 'ADMIN'), updateScore);
router.patch('/game/:sessionId/end', authenticate, authorize('STAFF', 'ADMIN'), endGame);

// Member/Staff view
router.get('/table/:tableId/live', authenticate, getLiveData);

module.exports = router;
