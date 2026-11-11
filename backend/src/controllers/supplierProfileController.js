// =============================================================================
// src/controllers/supplierProfileController.js
// MilJor Package E1: Supplier Profile Controller
// Endpoints for Supplier Business Profile, Onboarding Drafts, and Verification Submission
// =============================================================================
const profileService = require('../services/supplierProfileService');

class SupplierProfileController {
  /**
   * GET /api/v1/supplier/profile
   * Fetch authenticated supplier's own business profile
   */
  async getProfile(req, res) {
    try {
      const supplierId = req.user.id;
      const profile = await profileService.getProfile(supplierId);

      return res.status(200).json({
        success: true,
        data: { profile }
      });
    } catch (error) {
      console.error('Get Supplier Profile Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Could not fetch supplier profile' }
      });
    }
  }

  /**
   * PUT /api/v1/supplier/profile
   * Update permitted business profile fields (Save Draft or Update)
   */
  async updateProfile(req, res) {
    try {
      const supplierId = req.user.id;
      const result = await profileService.updateProfile(supplierId, req.body);

      return res.status(200).json({
        success: true,
        message: result.reReviewTriggered
          ? 'Profile updated successfully. Material changes submitted for verification re-review.'
          : 'Supplier business profile updated successfully',
        data: {
          profile: result.profile,
          re_review_triggered: result.reReviewTriggered
        }
      });
    } catch (error) {
      if (error.code === 'VALIDATION_ERROR') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: error.message,
            details: error.details
          }
        });
      }

      console.error('Update Supplier Profile Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Could not update supplier profile' }
      });
    }
  }

  /**
   * POST /api/v1/supplier/verification/submit
   * Submit complete profile for verification review
   */
  async submitVerification(req, res) {
    try {
      const supplierId = req.user.id;
      const result = await profileService.submitVerification(supplierId);

      return res.status(200).json({
        success: true,
        message: result.message,
        data: {
          verification_status: result.verification_status,
          submitted_at: result.submitted_at,
          already_pending: Boolean(result.alreadyPending),
          already_verified: Boolean(result.alreadyVerified)
        }
      });
    } catch (error) {
      if (error.code === 'INCOMPLETE_PROFILE') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INCOMPLETE_PROFILE',
            message: error.message,
            details: error.details
          }
        });
      }

      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: error.message }
        });
      }

      console.error('Submit Verification Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Could not submit verification application' }
      });
    }
  }

  /**
   * GET /api/v1/supplier/verification/status
   * Lightweight verification status for navigation badges & banners
   */
  async getVerificationStatus(req, res) {
    try {
      const supplierId = req.user.id;
      const status = await profileService.getVerificationStatus(supplierId);

      return res.status(200).json({
        success: true,
        data: { status }
      });
    } catch (error) {
      console.error('Get Verification Status Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Could not fetch verification status' }
      });
    }
  }
}

module.exports = new SupplierProfileController();
