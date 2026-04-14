const express = require('express');
const router = express.Router();
const {
  requestReservation,
  approveReservation,
  declineReservation,
  getMyReservations,
  getPendingReservations,
  getAllReservations,
} = require('../controllers/reservation.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

// Member
router.post('/', authenticate, requireRole('MEMBER'), requestReservation);
router.get('/my', authenticate, requireRole('MEMBER'), getMyReservations);

// Staff + Admin
router.get('/pending', authenticate, requireRole('STAFF', 'ADMIN'), getPendingReservations);
router.get('/', authenticate, requireRole('STAFF', 'ADMIN'), getAllReservations);
router.patch('/:reservationId/approve', authenticate, requireRole('STAFF', 'ADMIN'), approveReservation);
router.patch('/:reservationId/decline', authenticate, requireRole('STAFF', 'ADMIN'), declineReservation);

module.exports = router;
