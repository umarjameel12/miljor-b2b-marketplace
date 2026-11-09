// =============================================================================
// src/routes/v1/authRoutes.js
// Authentication & Identity Routes
// =============================================================================
const express = require('express');
const router = express.Router();
const authController = require('../../controllers/authController');
const { protect } = require('../../middlewares/authGuard');

// ---------------------------------------------------------------------------
// Public Routes
// ---------------------------------------------------------------------------
router.post('/register', (req, res) => authController.register(req, res));
router.post('/login', (req, res) => authController.login(req, res));
router.post('/refresh', (req, res) => authController.refresh(req, res));
router.post('/google', (req, res) => authController.googleAuth(req, res));
router.post('/verify-email', (req, res) => authController.verifyEmail(req, res));
router.post('/resend-otp', (req, res) => authController.resendOtp(req, res));
router.post('/request-password-reset', (req, res) => authController.requestPasswordReset(req, res));
router.post('/reset-password', (req, res) => authController.resetPassword(req, res));

// ---------------------------------------------------------------------------
// Protected Routes
// ---------------------------------------------------------------------------
router.get('/me', protect, (req, res) => authController.getMe(req, res));
router.post('/logout', (req, res, next) => {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return protect(req, res, (err) => {
      // If access token is expired or invalid, still proceed to logout using refresh cookie
      next();
    });
  }
  next();
}, (req, res) => authController.logout(req, res));
router.post('/google/link', protect, (req, res) => authController.googleLink(req, res));
router.post('/google/unlink', protect, (req, res) => authController.googleUnlink(req, res));
router.patch('/base-cluster', protect, (req, res) => authController.updateBaseCluster(req, res));
router.post('/supplier/apply', protect, (req, res) => authController.applyForSupplier(req, res));

module.exports = router;