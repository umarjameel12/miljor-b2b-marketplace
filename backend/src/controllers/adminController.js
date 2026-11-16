// =============================================================================
// src/controllers/adminController.js
// MilJor Administrative & Verification Operations
// Enforces:
//   - Least privilege access control per administrative role
//   - Self-approval prohibition (Suppliers cannot approve their own verification)
//   - Mandatory audit logging for every administrative state change
// =============================================================================
const db = require('../config/db');
const encryptionService = require('../services/encryptionService');
const validationService = require('../services/supplierValidationService');

class AdminController {

  // ---------------------------------------------------------------------------
  // GET /api/v1/admin/suppliers/pending
  // Permitted Roles: VERIFICATION_ADMIN, SUPER_ADMIN
  // Returns explicit allowlisted fields; never leaks raw bank_iban or ciphertext
  // ---------------------------------------------------------------------------
  async getPendingSuppliers(req, res) {
    try {
      const [rows] = await db.query(
        `SELECT
           sp.supplier_id,
           sp.business_type,
           sp.business_description,
           sp.contact_person_name,
           sp.contact_person_phone,
           sp.warehouse_address,
           sp.lahore_service_area,
           sp.tax_ntn,
           sp.food_license_no,
           sp.food_license_type,
           sp.bank_name,
           sp.bank_account_title,
           sp.bank_iban,
           sp.verification_status,
           sp.verification_level,
           sp.subscription_plan,
           sp.max_active_listings,
           sp.transaction_fee_percent,
           sp.rejection_reason,
           sp.submitted_revision,
           sp.correction_fields,
           sp.correction_notes,
           sp.submitted_at,
           sp.created_at,
           u.full_name,
           u.business_name,
           u.email,
           u.phone,
           u.city,
           u.area,
           u.address
         FROM supplier_profiles sp
         JOIN users u ON sp.supplier_id = u.id
         WHERE sp.verification_status IN ('PENDING_REVIEW', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED')
         ORDER BY sp.submitted_at ASC, sp.created_at ASC`
      );

      // Map to explicit response allowlist: mask banking identifiers, omit raw/ciphertext bank_iban
      const suppliers = rows.map((r) => {
        let bankIbanMasked = null;
        if (r.bank_iban) {
          if (encryptionService.isEncrypted(r.bank_iban)) {
            try {
              const decrypted = encryptionService.decrypt(r.bank_iban);
              bankIbanMasked = validationService.maskIban(decrypted);
            } catch {
              bankIbanMasked = 'PK** **** **** [CIPHERTEXT_ERROR]';
            }
          } else {
            // Strict security invariant: do not parse or mask raw legacy plaintext in normal API paths
            bankIbanMasked = 'PK** **** **** [LEGACY_MIGRATION_REQUIRED]';
          }
        }

        return {
          supplier_id: r.supplier_id,
          business_name: r.business_name || r.full_name,
          full_name: r.full_name,
          email: r.email,
          phone: r.phone,
          business_type: r.business_type || null,
          business_description: r.business_description || null,
          contact_person_name: r.contact_person_name || null,
          contact_person_phone: r.contact_person_phone || null,
          warehouse_address: r.warehouse_address || null,
          lahore_service_area: r.lahore_service_area || null,
          city: r.city || 'Lahore',
          area: r.area || null,
          address: r.address || null,
          tax_ntn: r.tax_ntn || null,
          food_license_no: r.food_license_no || null,
          food_license_type: r.food_license_type || null,
          bank_name: r.bank_name || null,
          bank_account_title: r.bank_account_title || null,
          bank_iban_masked: bankIbanMasked,
          verification_status: r.verification_status,
          verification_level: r.verification_level,
          subscription_plan: r.subscription_plan,
          max_active_listings: r.max_active_listings,
          transaction_fee_percent: r.transaction_fee_percent,
          rejection_reason: r.rejection_reason || null,
          submitted_revision: Number(r.submitted_revision || 0),
          correction_fields: typeof r.correction_fields==='string' ? JSON.parse(r.correction_fields) : (r.correction_fields || []),
          correction_notes: typeof r.correction_notes==='string' ? JSON.parse(r.correction_notes) : (r.correction_notes || {}),
          submitted_at: r.submitted_at || null,
          created_at: r.created_at
        };
      });

      return res.status(200).json({
        success: true,
        count: suppliers.length,
        data: { suppliers }
      });
    } catch (error) {
      console.error('Get Pending Suppliers Error:', error);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // PUT /api/v1/admin/suppliers/:id/verify
  // Permitted Roles: VERIFICATION_ADMIN, SUPER_ADMIN
  // Verifies/Rejects a supplier profile with tier and verification level
  // Enforces authorized plan listing caps (STARTER=4, GROWTH=13, BUSINESS=25)
  // ---------------------------------------------------------------------------
  async verifySupplier(req, res) {
    try {
      const { id } = req.params; // supplier_id (user id)
      const {
        verification_status,
        verification_level = 'LEVEL_2_BUSINESS',
        subscription_plan,
        max_active_listings,
        transaction_fee_percent,
        rejection_reason = null
      } = req.body;
      const adminId = req.user.id;

      // 1. Self-Verification Restriction
      if (parseInt(id) === adminId) {
        return res.status(403).json({
          success: false,
          error: { code: 'SELF_VERIFICATION_PROHIBITED', message: 'You cannot approve your own supplier account verification' }
        });
      }

      const validStatuses = ['VERIFIED', 'REJECTED', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED'];
      if (!validStatuses.includes(verification_status)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_STATUS', message: `Status must be one of: [${validStatuses.join(', ')}]` }
        });
      }

      // Rejected and information-requested decisions need actionable guidance.
      // Never mark a supplier rejected or awaiting more documents with no reason.
      if (['REJECTED', 'MORE_INFORMATION_REQUIRED'].includes(verification_status) &&
          (typeof rejection_reason !== 'string' || rejection_reason.trim().length < 5)) {
        return res.status(400).json({
          success: false,
          error: {code:'REASON_REQUIRED',message:'Please provide at least 5 characters explaining the decision'}
        });
      }

      // Server-side allowlists for verification level and subscription plan
      const ALLOWED_VERIFICATION_LEVELS = ['LEVEL_1_CONTACT', 'LEVEL_2_BUSINESS', 'LEVEL_3_QUALITY'];
      const ALLOWED_SUBSCRIPTION_PLANS = ['STARTER', 'GROWTH', 'BUSINESS'];
      const AUTHORIZED_PLAN_LISTING_CAPS = {
        STARTER: 4,
        GROWTH: 13,
        BUSINESS: 25
      };

      if (verification_level && !ALLOWED_VERIFICATION_LEVELS.includes(verification_level)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_VERIFICATION_LEVEL',
            message: `Verification level must be one of: [${ALLOWED_VERIFICATION_LEVELS.join(', ')}]`
          }
        });
      }

      if (subscription_plan && !ALLOWED_SUBSCRIPTION_PLANS.includes(subscription_plan)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_SUBSCRIPTION_PLAN',
            message: `Subscription plan must be one of: [${ALLOWED_SUBSCRIPTION_PLANS.join(', ')}]`
          }
        });
      }

      // Enforce exact authorized plan caps: STARTER=4, GROWTH=13, BUSINESS=25
      // Never allow admin UI input to silently bypass authorized limits
      const effectivePlan = subscription_plan || 'GROWTH';
      const authorizedPlanCap = AUTHORIZED_PLAN_LISTING_CAPS[effectivePlan] || 4;

      let effectiveListingCap = authorizedPlanCap;
      if (max_active_listings !== undefined && max_active_listings !== null) {
        let isValidInteger = false;
        let requestedCap = NaN;

        if (typeof max_active_listings === 'number') {
          if (Number.isInteger(max_active_listings) && Number.isSafeInteger(max_active_listings) && max_active_listings >= 1) {
            isValidInteger = true;
            requestedCap = max_active_listings;
          }
        } else if (typeof max_active_listings === 'string') {
          const trimmed = max_active_listings.trim();
          if (/^[1-9]\d*$/.test(trimmed)) {
            const num = Number(trimmed);
            if (Number.isSafeInteger(num) && num >= 1) {
              isValidInteger = true;
              requestedCap = num;
            }
          }
        }

        if (!isValidInteger) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_LISTING_CAP',
              message: 'max_active_listings must be an exact positive safe integer (decimals, trailing characters, arrays, and objects are prohibited)'
            }
          });
        }

        if (requestedCap > authorizedPlanCap) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'PLAN_CAP_EXCEEDED',
              message: `max_active_listings for plan ${effectivePlan} cannot exceed authorized cap of ${authorizedPlanCap} (requested: ${max_active_listings})`
            }
          });
        }

        effectiveListingCap = requestedCap;
      }

      // Verification and commercial subscription entitlements are independent.
      // Admin review never changes supplier plan, fees or paid listing caps.
      if (subscription_plan !== undefined || max_active_listings !== undefined || transaction_fee_percent !== undefined) {
        return res.status(400).json({ success: false, error: {
          code: 'SUBSCRIPTION_MANAGED_SEPARATELY',
          message: 'Subscription plan, listing cap and transaction fee are managed only by verified billing flows'
        } });
      }
      if (['UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED', 'REJECTED'].includes(verification_status) &&
          verification_level !== 'LEVEL_2_BUSINESS') {
        return res.status(400).json({ success: false, error: { code: 'REVIEW_LEVEL_CHANGE_NOT_ALLOWED', message: 'Review-only decisions cannot change the verification level' } });
      }

      const corrections = req.body.correction_fields;
      const correctionNotes = req.body.correction_notes;
      const correctionAllowlist = new Set([
        'business_name','business_type','business_description','contact_person_name',
        'contact_person_phone','warehouse_address','lahore_service_area','tax_ntn',
        'food_license_no','food_license_type','bank_name','bank_account_title','bank_iban',
        'document:BUSINESS_LICENSE','document:TAX_CERTIFICATE',
        'document:WAREHOUSE_PROOF','document:BANK_PROOF'
      ]);
      if (verification_status === 'MORE_INFORMATION_REQUIRED' &&
        (!Array.isArray(corrections) || !corrections.length || corrections.length>17 ||
          new Set(corrections).size !== corrections.length ||
          corrections.some(field=>typeof field!=='string'||!correctionAllowlist.has(field)))) {
        return res.status(400).json({success:false,error:{
          code:'CORRECTION_FIELDS_REQUIRED',
          message:'Select at least one valid field that the supplier must correct'
        }});
      }
      if (verification_status === 'MORE_INFORMATION_REQUIRED' &&
          (correctionNotes === null || typeof correctionNotes !== 'object' ||
           Array.isArray(correctionNotes) || corrections.some(field =>
             typeof correctionNotes[field] !== 'string' || correctionNotes[field].trim().length < 5 ||
             correctionNotes[field].length > 1000))) {
        return res.status(400).json({success:false,error:{
          code:'FIELD_SPECIFIC_NOTES_REQUIRED',
          message:'Explain each requested correction in at least five characters'
        }});
      }
      if (verification_status !== 'MORE_INFORMATION_REQUIRED' &&
          (corrections !== undefined || correctionNotes !== undefined)) {
        return res.status(400).json({success:false,error:{
          code:'UNEXPECTED_CORRECTION_FIELDS',message:'Correction requests are only allowed for Request Info'
        }});
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        // Lock the reviewed profile before comparing its state; eliminate stale concurrent decisions.
        const [profiles] = await connection.query(
          'SELECT supplier_id, verification_status, verification_level, subscription_plan, submitted_revision FROM supplier_profiles WHERE supplier_id = ? FOR UPDATE',
          [id]
        );
        const current = profiles[0];
        if (!current) {
          await connection.rollback();
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Supplier profile not found' } });
        }
        const allowedTransitions = {
          PENDING_REVIEW: ['UNDER_REVIEW', 'VERIFIED', 'MORE_INFORMATION_REQUIRED', 'REJECTED'],
          UNDER_REVIEW: ['VERIFIED', 'MORE_INFORMATION_REQUIRED', 'REJECTED']
        };
        if (!(allowedTransitions[current.verification_status] || []).includes(verification_status)) {
          await connection.rollback();
          return res.status(409).json({ success: false, error: {
            code: 'STALE_OR_INVALID_VERIFICATION_TRANSITION',
            message: 'Supplier review changed or has already been decided. Refresh before proceeding.'
          } });
        }
        if (req.body.expected_status && req.body.expected_status !== current.verification_status) {
          await connection.rollback();
          return res.status(409).json({ success: false, error: { code: 'STALE_REVIEW', message: 'Review status has changed' } });
        }

        // The admin must review the exact immutable revision, not a subsequently corrected form.
        if (Number(current.submitted_revision || 0) > 0 &&
            (!Number.isSafeInteger(Number(req.body.expected_revision)) ||
             Number(req.body.expected_revision) !== Number(current.submitted_revision))) {
          await connection.rollback();
          return res.status(409).json({success:false,error:{
            code:'STALE_REVIEW_REVISION',message:'Supplier application revision changed; refresh before deciding'
          }});
        }
        const isApproved = verification_status === 'VERIFIED';
        const effectiveRejectionReason = isApproved ? null : (rejection_reason || null);
        await connection.query(
          `UPDATE supplier_profiles SET verification_status = ?,
             verification_level = CASE WHEN ? = 1 THEN ? ELSE verification_level END,
             rejection_reason = ?,
             verified_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE verified_at END,
             correction_fields = ?, correction_notes = ?,
             correction_requested_revision = ?, correction_requested_at = CASE WHEN ? = 1 THEN UTC_TIMESTAMP() ELSE NULL END
           WHERE supplier_id = ?`,
          [verification_status, isApproved ? 1 : 0, verification_level, effectiveRejectionReason,
           isApproved ? 1 : 0,
           verification_status === 'MORE_INFORMATION_REQUIRED' ? JSON.stringify(corrections) : null,
           verification_status === 'MORE_INFORMATION_REQUIRED' ? JSON.stringify(correctionNotes) : null,
           verification_status === 'MORE_INFORMATION_REQUIRED' ? Number(current.submitted_revision||0) : null,
           verification_status === 'MORE_INFORMATION_REQUIRED' ? 1 : 0, id]
        );
        if (Number(current.submitted_revision || 0) > 0 && verification_status !== 'UNDER_REVIEW') {
          const reviewAction = isApproved ? 'APPROVED' :
            verification_status === 'REJECTED' ? 'REJECTED' : 'REQUEST_INFO';
          const [revisionWrite] = await connection.query(
            `UPDATE supplier_verification_revisions
             SET review_action=?, reviewed_by=?, reviewed_at=UTC_TIMESTAMP(), review_reason=?
             WHERE supplier_id=? AND revision=? AND review_action='PENDING'`,
            [reviewAction,adminId,effectiveRejectionReason,id,Number(current.submitted_revision)]
          );
          if(revisionWrite.affectedRows!==1) {
            const e=new Error('Reviewed revision already decided');
            e.code='STALE_REVIEW_REVISION';e.statusCode=409;throw e;
          }
        }
        // Review-only actions do not strip existing account/trust status.
        if (isApproved) {
          await connection.query(
            `UPDATE users SET role = 'SUPPLIER', is_verified = 1, verification_status = 'VERIFIED' WHERE id = ?`,
            [id]
          );
        }
        await connection.query(
          `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
           VALUES (?, ?, 'SUPPLIER_VERIFICATION_UPDATE', 'supplier_profiles', ?, ?, ?)`,
          [adminId, req.user.role, id,
           JSON.stringify({ status: current.verification_status }),
           JSON.stringify({ verification_status, verification_level: isApproved ? verification_level : current.verification_level, reason: effectiveRejectionReason })]
        );
        await connection.commit();
        return res.status(200).json({
          success: true, message: `Supplier verification status updated to '${verification_status}'`,
          data: { supplier_id: Number(id), verification_status,
            verification_level: isApproved ? verification_level : current.verification_level,
            subscription_plan: current.subscription_plan, rejection_reason: effectiveRejectionReason }
        });
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }

    } catch (error) {
      if(error.statusCode && error.statusCode < 500) {
        return res.status(error.statusCode).json({success:false,error:{code:error.code,message:error.message}});
      }
      console.error('Verify Supplier Error:', error);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Supplier review could not be processed' } });
    }
  }

  // ---------------------------------------------------------------------------
  // PUT /api/v1/admin/users/:id/suspend
  // Permitted Roles: OPERATIONS_ADMIN, SUPER_ADMIN
  // Suspends/Blocks a compromised or fraudulent user account
  // ---------------------------------------------------------------------------
  async suspendUser(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const adminId = req.user.id;

      if (parseInt(id) === adminId) {
        return res.status(403).json({
          success: false,
          error: { code: 'SELF_SUSPENSION_PROHIBITED', message: 'You cannot suspend your own administrative account' }
        });
      }

      const [users] = await db.query('SELECT id, role, verification_status FROM users WHERE id = ?', [id]);
      if (!users[0]) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      }

      await db.query(
        `UPDATE users
         SET verification_status = 'BLOCKED', buyer_trust_status = 'SUSPENDED'
         WHERE id = ?`,
        [id]
      );

      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, ?, 'USER_SUSPENDED', 'users', ?, ?)`,
        [adminId, req.user.role, id, JSON.stringify({ reason: reason || 'Administrative suspension' })]
      );

      return res.status(200).json({
        success: true,
        message: 'User account has been suspended successfully.',
        data: { user_id: parseInt(id), status: 'SUSPENDED' }
      });

    } catch (error) {
      console.error('Suspend User Error:', error);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // PUT /api/v1/admin/users/:id/reactivate
  // Permitted Roles: SUPER_ADMIN
  // ---------------------------------------------------------------------------
  async reactivateUser(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user.id;

      const [users] = await db.query('SELECT id, role FROM users WHERE id = ?', [id]);
      if (!users[0]) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      }

      await db.query(
        `UPDATE users
         SET verification_status = 'VERIFIED', buyer_trust_status = 'TRUSTED_BUYER'
         WHERE id = ?`,
        [id]
      );

      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, ?, 'USER_REACTIVATED', 'users', ?, ?)`,
        [adminId, req.user.role, id, JSON.stringify({ status: 'REACTIVATED' })]
      );

      return res.status(200).json({
        success: true,
        message: 'User account has been reactivated successfully.',
        data: { user_id: parseInt(id), status: 'ACTIVE' }
      });

    } catch (error) {
      console.error('Reactivate User Error:', error);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }
}

module.exports = new AdminController();
