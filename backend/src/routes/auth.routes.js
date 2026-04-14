const express = require('express');
const router = express.Router();
const {
  register,
  verifyEmail,
  resendVerification,
  createStaff,
  login,
  refresh,
  logout,
  getMe,
  registerValidation,
  loginValidation,
  createStaffValidation,
} = require('../controllers/auth.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

// Public routes
router.post('/register', registerValidation, register);
router.get('/verify-email', verifyEmail);                  // GET /api/auth/verify-email?token=xxx
router.post('/resend-verification', resendVerification);   // POST /api/auth/resend-verification
router.post('/login', loginValidation, login);
router.post('/refresh', refresh);
router.post('/logout', logout);

// Protected
router.get('/me', authenticate, getMe);

// Admin only: create staff account
router.post(
  '/create-staff',
  authenticate,
  requireRole('ADMIN'),
  createStaffValidation,
  createStaff
);

module.exports = router;
