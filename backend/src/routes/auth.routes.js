const express = require('express');
const router = express.Router();
const {
  register,
  verifyEmail,
  resendVerification,
  verificationStatus,
  resetVerificationForDevelopment,
  createStaff,
  login,
  refresh,
  logout,
  getMe,
  forgotPassword,
  resetPasswordPage,
  resetPasswordPageScript,
  resetPassword,
  registerValidation,
  loginValidation,
  createStaffValidation,
} = require('../controllers/auth.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

// Public routes
router.post('/register', registerValidation, register);
router.get('/verify-email', verifyEmail);                  // GET /api/auth/verify-email?token=xxx
router.post('/resend-verification', resendVerification);   // POST /api/auth/resend-verification
router.post('/verification-status', verificationStatus);   // POST /api/auth/verification-status
router.post('/dev/reset-verification', resetVerificationForDevelopment);
router.post('/forgot-password', forgotPassword);           // POST /api/auth/forgot-password
router.get('/reset-password', resetPasswordPage);          // GET /api/auth/reset-password?token=xxx
router.get('/reset-password-page.js', resetPasswordPageScript);
router.post('/reset-password', resetPassword);             // POST /api/auth/reset-password
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
