// =============================================================================
// src/services/supplierProfileService.js
// MilJor Package E1: Supplier Profile & Verification Service
// Handles business logic for onboarding, validation, draft saves, and verification submissions
// =============================================================================
const crypto = require('node:crypto');
const { recordInAppOnConnection } = require('./ucpTransactionalNotifications');
const defaultDb = require('../config/db');
const supplierProfileRepo = require('../repositories/supplierProfileRepository');
const validationService = require('./supplierValidationService');

class SupplierProfileService {
  // Resolve recipients on the mutation's connection; only verification-authorized
  // administrators receive verification escalations.
  async recordIdentityEvent(connection, userId, type, { transitionId = crypto.randomUUID(), escalate = false } = {}) {
    const [users] = await connection.query('SELECT id, role FROM users WHERE id = ?', [userId]);
    if (!users[0]) throw new Error('NOTIFICATION_OWNER_NOT_FOUND');
    const recipients = [{ userId: Number(users[0].id), role: users[0].role }];
    if (escalate) {
      const [admins] = await connection.query(
        "SELECT id, role FROM users WHERE role IN ('SUPER_ADMIN', 'ADMIN', 'VERIFICATION_ADMIN') AND is_verified = 1 AND verification_status <> 'BLOCKED'", []);
      recipients.push(...admins.filter(row => Number(row.id) !== Number(userId))
        .map(row => ({ userId: Number(row.id), role: row.role })));
    }
    const content = {
      'IDENTITY.EMAIL_VERIFIED': ['Email verified', 'Your email has been verified successfully.'],
      'IDENTITY.REGISTERED': ['Welcome to MilJor', 'Your MilJor account has been created.'],
      'IDENTITY.VERIFICATION_SUBMITTED': ['Verification submitted', 'A supplier verification submission has been recorded. Open MilJor to review its status.'],
      'IDENTITY.VERIFICATION_APPROVED': ['Verification approved', 'Your account verification has been approved.'],
      'IDENTITY.VERIFICATION_INFO_REQUESTED': ['Verification information required', 'Open your supplier profile to review the information requested by the verification team.'],
      'IDENTITY.VERIFICATION_UNDER_REVIEW': ['Verification under review', 'Your supplier verification application is being reviewed.'],
      'IDENTITY.VERIFICATION_SUSPENDED': ['Supplier verification suspended', 'Your supplier verification has been suspended. Open your supplier profile to review its status.'],
      'IDENTITY.VERIFICATION_REJECTED': ['Verification rejected', 'Open your supplier profile to review the verification decision.'],
      'IDENTITY.SECURITY_ALERT': ['Account security change', 'An authentication method on your account has changed. If you did not make this change, contact support.'],
      'IDENTITY.ACCOUNT_LOCKED': ['Account suspended', 'Your account has been suspended. Contact support to review this decision.'],
      'IDENTITY.ACCOUNT_UNLOCKED': ['Account reactivated', 'Your account has been reactivated.'],
      'CATALOG.SERVICE_AREA_CHANGED': ['Service area updated', 'Your supplier service coverage has changed. Review your delivery settings in MilJor.']
    }[type];
    if (!content) throw new Error('UNSUPPORTED_IDENTITY_RECEIPT');
    for (let offset = 0; offset < recipients.length; offset += 100) {
      await recordInAppOnConnection(connection, { type, aggregateId: 'user-' + users[0].id,
        aggregateVersion: 1, transitionId, recipients: recipients.slice(offset, offset + 100),
        title: content[0], message: content[1], payload: { account_id: Number(users[0].id) } });
    }
  }

  /**
   * Evaluates mandatory fields and onboarding completion
   */
  evaluateOnboardingCompletion(profile) {
    const requiredForSubmission = [
      { key: 'business_name', label: 'Registered Business Name' },
      { key: 'business_type', label: 'Wholesale Business Type' },
      { key: 'contact_person_name', label: 'Primary Contact Person Name' },
      { key: 'contact_person_phone', label: 'Authorized Contact Phone' },
      { key: 'warehouse_address', label: 'Warehouse / Dispatch Address' },
      { key: 'lahore_service_area', label: 'Lahore Primary Service Area' },
      { key: 'bank_name', label: 'Settlement Bank Name' },
      { key: 'bank_account_title', label: 'Bank Account Title' },
      { key: 'bank_iban', label: 'Pakistani IBAN' }
    ];

    const missingFields = [];
    let completedCount = 0;

    for (const field of requiredForSubmission) {
      const val = profile[field.key];
      if (val !== undefined && val !== null && String(val).trim().length > 0) {
        completedCount++;
      } else {
        missingFields.push(field);
      }
    }

    const completionPercent = Math.round((completedCount / requiredForSubmission.length) * 100);

    return {
      completionPercent,
      canSubmit: missingFields.length === 0,
      missingFields
    };
  }

  /**
   * Retrieves profile for authenticated supplier with masked sensitive data
   */
  async getProfile(supplierId) {
    let profile = await supplierProfileRepo.findBySupplierId(supplierId);
    if (!profile) {
      profile = await supplierProfileRepo.ensureProfileExists(supplierId);
    }

    const onboarding = this.evaluateOnboardingCompletion(profile);

    return {
      supplier_id: profile.supplier_id,
      business_name: profile.business_name || '',
      business_type: profile.business_type || '',
      business_description: profile.business_description || '',
      email: profile.email,
      phone: profile.phone,
      contact_person_name: profile.contact_person_name || '',
      contact_person_phone: profile.contact_person_phone || '',
      address: profile.address || '',
      area: profile.area || '',
      warehouse_address: profile.warehouse_address || '',
      lahore_service_area: profile.lahore_service_area || '',
      city: 'Lahore',
      tax_ntn: profile.tax_ntn || '',
      food_license_no: profile.food_license_no || '',
      food_license_type: profile.food_license_type || 'PUNJAB_FOOD_AUTHORITY',
      bank_name: profile.bank_name || '',
      bank_account_title: profile.bank_account_title || '',
      bank_iban_masked: validationService.maskIban(profile.bank_iban),
      has_bank_details: Boolean(profile.bank_iban),
      verification_status: profile.verification_status || 'NOT_SUBMITTED',
      verification_level: profile.verification_level || 'LEVEL_1_CONTACT',
      subscription_plan: profile.subscription_plan || 'STARTER',
      max_active_listings: profile.max_active_listings || 5,
      transaction_fee_percent: profile.transaction_fee_percent || '2.50',
      is_verified: Boolean(profile.is_verified),
      rejection_reason: profile.rejection_reason || null,
      submitted_at: profile.submitted_at || null,
      verified_at: profile.verified_at || null,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
      onboarding
    };
  }

  /**
   * Updates profile fields (Draft save or update)
   */
  async updateProfile(supplierId, updatePayload) {
    // 1. Prohibit client-controlled modification of security/status fields
    const forbiddenFields = [
      'id',
      'supplier_id',
      'verification_status',
      'verification_level',
      'subscription_plan',
      'max_active_listings',
      'transaction_fee_percent',
      'is_verified',
      'role',
      'rejection_reason',
      'submitted_at',
      'verified_at'
    ];

    for (const field of forbiddenFields) {
      if (updatePayload[field] !== undefined) {
        delete updatePayload[field];
      }
    }

    // 2. Validate input fields
    const validation = validationService.validateProfileData(updatePayload, false);
    if (!validation.valid) {
      const err = new Error(validation.errors.join('; '));
      err.code = 'VALIDATION_ERROR';
      err.details = validation.errors;
      throw err;
    }

    // 3. Ensure profile row exists
    await supplierProfileRepo.ensureProfileExists(supplierId);

    // 4. Check if supplier is already verified and material fields changed
    const connection = await defaultDb.getConnection();
    try {
      await connection.beginTransaction();

      await supplierProfileRepo.lockForUpdate(supplierId, connection);
      const currentProfile = await supplierProfileRepo.findBySupplierId(supplierId, connection);

      // Material fields that trigger re-review if changed on a verified supplier
      const materialFieldKeys = ['business_name', 'tax_ntn', 'food_license_no', 'bank_iban', 'bank_account_title'];
      const changedMaterialFields = [];

      for (const key of materialFieldKeys) {
        if (
          validation.sanitized[key] !== undefined &&
          validation.sanitized[key] !== currentProfile[key] &&
          currentProfile[key] !== null
        ) {
          changedMaterialFields.push(key);
        }
      }

      // Update details
      const updated = await supplierProfileRepo.updateProfileDetails(supplierId, validation.sanitized, connection);

      // Trigger re-review if verified supplier changed material business identity or payout details
      let reReviewTriggered = false;
      if (currentProfile.verification_status === 'VERIFIED' && changedMaterialFields.length > 0) {
        await supplierProfileRepo.triggerReReview(supplierId, changedMaterialFields, connection);
        reReviewTriggered = true;
        await this.recordIdentityEvent(connection, currentProfile.supplier_id, 'IDENTITY.VERIFICATION_SUBMITTED', { escalate: true });
      }

      if (validation.sanitized.lahore_service_area !== undefined &&
          validation.sanitized.lahore_service_area !== currentProfile.lahore_service_area) {
        await this.recordIdentityEvent(connection, updated.supplier_id, 'CATALOG.SERVICE_AREA_CHANGED');
      }
      await connection.commit();

      const profile = await this.getProfile(supplierId);
      return {
        profile,
        reReviewTriggered
      };

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Submits profile for administrative verification review
   */
  async submitVerification(supplierId) {
    const profile = await supplierProfileRepo.findBySupplierId(supplierId);
    if (!profile) {
      const err = new Error('Supplier profile not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    // Idempotent handling: if already pending or under review
    if (profile.verification_status === 'PENDING_REVIEW' || profile.verification_status === 'UNDER_REVIEW') {
      return {
        success: true,
        alreadyPending: true,
        message: 'Your verification application is already pending review with our verification team.',
        verification_status: profile.verification_status,
        submitted_at: profile.submitted_at
      };
    }

    // If already verified
    if (profile.verification_status === 'VERIFIED') {
      return {
        success: true,
        alreadyVerified: true,
        message: 'Your supplier account is already verified.',
        verification_status: 'VERIFIED',
        verified_at: profile.verified_at
      };
    }

    // Check mandatory fields for submission
    const profileDataToValidate = {
      business_name: profile.business_name,
      business_type: profile.business_type,
      contact_person_name: profile.contact_person_name,
      contact_person_phone: profile.contact_person_phone,
      warehouse_address: profile.warehouse_address,
      lahore_service_area: profile.lahore_service_area,
      bank_name: profile.bank_name,
      bank_account_title: profile.bank_account_title,
      bank_iban: profile.bank_iban,
      tax_ntn: profile.tax_ntn,
      food_license_no: profile.food_license_no,
      food_license_type: profile.food_license_type
    };

    const validation = validationService.validateProfileData(profileDataToValidate, true);
    if (!validation.valid) {
      const err = new Error(`Cannot submit incomplete profile: ${validation.errors.join('; ')}`);
      err.code = 'INCOMPLETE_PROFILE';
      err.details = validation.errors;
      throw err;
    }

    // Perform atomic submission
    const connection = await defaultDb.getConnection();
    try {
      await connection.beginTransaction();

      await supplierProfileRepo.lockForUpdate(supplierId, connection);
      const locked = await supplierProfileRepo.findBySupplierId(supplierId, connection);
      if (!locked) throw new Error('Supplier profile not found');
      if (['PENDING_REVIEW', 'UNDER_REVIEW', 'VERIFIED'].includes(locked.verification_status)) {
        await connection.commit();
        return { success: true, alreadyPending: locked.verification_status !== 'VERIFIED',
          alreadyVerified: locked.verification_status === 'VERIFIED',
          message: locked.verification_status === 'VERIFIED' ? 'Your supplier account is already verified.' :
            'Your verification application is already pending review with our verification team.',
          verification_status: locked.verification_status, submitted_at: locked.submitted_at, verified_at: locked.verified_at };
      }
      const lockedValidation = validationService.validateProfileData(locked, true);
      if (!lockedValidation.valid) {
        const err = new Error(`Cannot submit incomplete profile: ${lockedValidation.errors.join('; ')}`);
        err.code = 'INCOMPLETE_PROFILE'; err.details = lockedValidation.errors; throw err;
      }
      const updated = await supplierProfileRepo.submitForReview(supplierId, connection);
      await this.recordIdentityEvent(connection, updated.supplier_id, 'IDENTITY.VERIFICATION_SUBMITTED', { escalate: true });

      await connection.commit();

      return {
        success: true,
        message: 'Supplier verification application submitted successfully. Verification team will review within 2 business days.',
        verification_status: 'PENDING_REVIEW',
        submitted_at: updated.submitted_at
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Lightweight verification status check for badges & navigation
   */
  async getVerificationStatus(supplierId) {
    const profile = await supplierProfileRepo.findBySupplierId(supplierId);
    if (!profile) {
      return {
        verification_status: 'NOT_SUBMITTED',
        is_verified: false,
        verification_level: 'LEVEL_1_CONTACT',
        subscription_plan: 'STARTER',
        rejection_reason: null,
        submitted_at: null,
        verified_at: null
      };
    }

    return {
      verification_status: profile.verification_status || 'NOT_SUBMITTED',
      is_verified: Boolean(profile.is_verified),
      verification_level: profile.verification_level || 'LEVEL_1_CONTACT',
      subscription_plan: profile.subscription_plan || 'STARTER',
      rejection_reason: profile.rejection_reason || null,
      submitted_at: profile.submitted_at || null,
      verified_at: profile.verified_at || null
    };
  }
}

module.exports = new SupplierProfileService();
