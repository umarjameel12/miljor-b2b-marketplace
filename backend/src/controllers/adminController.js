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
          try {
            if (encryptionService.isEncrypted(r.bank_iban)) {
              const decrypted = encryptionService.decrypt(r.bank_iban);
              bankIbanMasked = validationService.maskIban(decrypted);
            } else {
              // Legacy unencrypted in db masked safely
              bankIbanMasked = validationService.maskIban(r.bank_iban);
            }
          } catch {
            bankIbanMasked = 'PK** **** **** [ENCRYPTED]';
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
        subscription_plan = 'GROWTH',
        max_active_listings,
        transaction_fee_percent = 1.50,
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

      const validStatuses = ['VERIFIED', 'REJECTED', 'SUSPENDED', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED'];
      if (!validStatuses.includes(verification_status)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_STATUS', message: `Status must be one of: [${validStatuses.join(', ')}]` }
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

      if (max_active_listings !== undefined && max_active_listings !== null) {
        const requestedCap = parseInt(max_active_listings, 10);
        if (isNaN(requestedCap) || requestedCap < 1) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_LISTING_CAP',
              message: 'max_active_listings must be a positive integer'
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
      }

      const effectiveListingCap = (max_active_listings !== undefined && max_active_listings !== null)
        ? parseInt(max_active_listings, 10)
        : authorizedPlanCap;

      // Check supplier profile exists
      const [profiles] = await db.query('SELECT * FROM supplier_profiles WHERE supplier_id = ?', [id]);
      if (!profiles[0]) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Supplier profile not found' } });
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        const isApproved = verification_status === 'VERIFIED';
        const effectiveRejectionReason = isApproved ? null : (rejection_reason || null);

        // Update supplier profile
        await connection.query(
          `UPDATE supplier_profiles
           SET verification_status = ?,
               verification_level = ?,
               subscription_plan = ?,
               max_active_listings = ?,
               transaction_fee_percent = ?,
               rejection_reason = ?,
               verified_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE verified_at END
           WHERE supplier_id = ?`,
          [verification_status, verification_level, effectivePlan, effectiveListingCap, transaction_fee_percent, effectiveRejectionReason, isApproved ? 1 : 0, id]
        );

        // Update users table
        await connection.query(
          `UPDATE users
           SET role = CASE WHEN ? = 1 THEN 'SUPPLIER' ELSE role END,
               is_verified = ?,
               verification_status = ?
           WHERE id = ?`,
          [isApproved ? 1 : 0, isApproved ? 1 : 0, isApproved ? 'VERIFIED' : 'PENDING_SUPPLIER_VERIFICATION', id]
        );

        // Audit Log
        await connection.query(
          `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
           VALUES (?, ?, 'SUPPLIER_VERIFICATION_UPDATE', 'supplier_profiles', ?, ?, ?)`,
          [
            adminId,
            req.user.role,
            id,
            JSON.stringify({ status: profiles[0].verification_status }),
            JSON.stringify({ verification_status, verification_level, subscription_plan })
          ]
        );

        await connection.commit();
        connection.release();

        return res.status(200).json({
          success: true,
          message: `Supplier verification status updated to '${verification_status}'`,
          data: {
            supplier_id: parseInt(id),
            verification_status,
            verification_level,
            subscription_plan,
            rejection_reason: effectiveRejectionReason
          }
        });

      } catch (err) {
        await connection.rollback();
        connection.release();
        throw err;
      }

    } catch (error) {
      console.error('Verify Supplier Error:', error);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
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
