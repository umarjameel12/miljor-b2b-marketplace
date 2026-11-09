// =============================================================================
// src/repositories/supplierProfileRepository.js
// MilJor Package E1: Supplier Profile & Verification Repository
// Handles persistence for supplier business profiles, banking, and verification state
// =============================================================================
const defaultDb = require('../config/db');
const encryptionService = require('../services/encryptionService');

class SupplierProfileRepository {
  /**
   * Fetch supplier profile with user details
   */
  async findBySupplierId(supplierId, connection) {
    const db = connection || defaultDb;
    const [rows] = await db.query(
      `SELECT 
        sp.id AS profile_id,
        sp.supplier_id,
        sp.business_type,
        sp.verification_level,
        sp.verification_status,
        sp.subscription_plan,
        sp.max_active_listings,
        sp.transaction_fee_percent,
        sp.tax_ntn,
        sp.food_license_no,
        sp.food_license_type,
        sp.business_description,
        sp.contact_person_name,
        sp.contact_person_phone,
        sp.warehouse_address,
        sp.lahore_service_area,
        sp.bank_name,
        sp.bank_account_title,
        sp.bank_iban,
        sp.rejection_reason,
        sp.submitted_at,
        sp.verified_at,
        sp.created_at,
        sp.updated_at,
        u.full_name,
        u.business_name,
        u.email,
        u.phone,
        u.city,
        u.area,
        u.address,
        u.role,
        u.is_verified,
        u.verification_status AS user_verification_status,
        u.base_cluster_id
       FROM supplier_profiles sp
       JOIN users u ON sp.supplier_id = u.id
       WHERE sp.supplier_id = ?`,
      [supplierId]
    );

    const profile = rows[0] || null;
    if (profile && profile.bank_iban) {
      try {
        profile.bank_iban_is_encrypted = encryptionService.isEncrypted(profile.bank_iban);
        profile.bank_iban = encryptionService.decrypt(profile.bank_iban, { allowLegacy: true });
      } catch (e) {
        console.error('Warning: could not decrypt bank_iban for supplier:', supplierId, e.message);
        profile.bank_iban = null;
        profile.bank_iban_decrypt_error = e.code || 'DECRYPTION_ERROR';
      }
    }

    return profile;
  }

  /**
   * Acquire exclusive row lock on supplier profile inside active transaction
   */
  async lockForUpdate(supplierId, connection) {
    const db = connection || defaultDb;
    const [rows] = await db.query(
      `SELECT * FROM supplier_profiles WHERE supplier_id = ? FOR UPDATE`,
      [supplierId]
    );
    return rows[0] || null;
  }

  /**
   * Ensure a supplier profile exists, creating default if missing
   */
  async ensureProfileExists(supplierId, connection) {
    const db = connection || defaultDb;
    const existing = await this.findBySupplierId(supplierId, db);
    if (existing) return existing;

    await db.query(
      `INSERT INTO supplier_profiles
        (supplier_id, verification_level, verification_status, subscription_plan, max_active_listings, transaction_fee_percent)
       VALUES (?, 'LEVEL_1_CONTACT', 'NOT_SUBMITTED', 'STARTER', 4, 2.50)
       ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
      [supplierId]
    );

    return await this.findBySupplierId(supplierId, db);
  }

  /**
   * Update supplier business and profile details atomically
   */
  async updateProfileDetails(supplierId, sanitizedData, connection) {
    const db = connection || defaultDb;

    // Allowed profile columns in supplier_profiles
    const profileColumns = [
      'business_type',
      'business_description',
      'contact_person_name',
      'contact_person_phone',
      'warehouse_address',
      'lahore_service_area',
      'tax_ntn',
      'food_license_no',
      'food_license_type',
      'bank_name',
      'bank_account_title',
      'bank_iban'
    ];

    const profileUpdates = [];
    const profileValues = [];

    for (const col of profileColumns) {
      if (sanitizedData[col] !== undefined) {
        profileUpdates.push(`${col} = ?`);
        if (col === 'bank_iban' && sanitizedData.bank_iban) {
          // Sensitive data protection: must strictly encrypt before storing in MySQL.
          // Fails closed if encryption key is not configured.
          const valToStore = encryptionService.encrypt(sanitizedData.bank_iban);
          profileValues.push(valToStore);
        } else {
          profileValues.push(sanitizedData[col]);
        }
      }
    }

    if (profileUpdates.length > 0) {
      profileValues.push(supplierId);
      await db.query(
        `UPDATE supplier_profiles SET ${profileUpdates.join(', ')} WHERE supplier_id = ?`,
        profileValues
      );
    }

    // Sync business_name, area, and address into users table
    const userUpdates = [];
    const userValues = [];

    if (sanitizedData.business_name !== undefined) {
      userUpdates.push('business_name = ?');
      userValues.push(sanitizedData.business_name);
    }
    if (sanitizedData.lahore_service_area !== undefined) {
      userUpdates.push('area = ?');
      userValues.push(sanitizedData.lahore_service_area);
    }
    if (sanitizedData.warehouse_address !== undefined) {
      userUpdates.push('address = ?');
      userValues.push(sanitizedData.warehouse_address);
    }

    if (userUpdates.length > 0) {
      userValues.push(supplierId);
      await db.query(
        `UPDATE users SET ${userUpdates.join(', ')} WHERE id = ?`,
        userValues
      );
    }

    return await this.findBySupplierId(supplierId, db);
  }

  /**
   * Submit supplier profile for administrative verification review
   */
  async submitForReview(supplierId, connection) {
    const db = connection || defaultDb;

    await db.query(
      `UPDATE supplier_profiles
       SET verification_status = 'PENDING_REVIEW',
           submitted_at = CURRENT_TIMESTAMP,
           rejection_reason = NULL
       WHERE supplier_id = ?`,
      [supplierId]
    );

    await db.query(
      `UPDATE users
       SET verification_status = 'PENDING_SUPPLIER_VERIFICATION'
       WHERE id = ?`,
      [supplierId]
    );

    await db.query(
      `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
       VALUES (?, 'SUPPLIER', 'SUPPLIER_VERIFICATION_SUBMITTED', 'supplier_profiles', ?, ?)`,
      [supplierId, supplierId, JSON.stringify({ status: 'PENDING_REVIEW', submitted_at: new Date().toISOString() })]
    );

    return await this.findBySupplierId(supplierId, db);
  }

  /**
   * Revert verified supplier to pending review if material details are updated
   */
  async triggerReReview(supplierId, materialChanges, connection) {
    const db = connection || defaultDb;

    await db.query(
      `UPDATE supplier_profiles
       SET verification_status = 'PENDING_REVIEW',
           submitted_at = CURRENT_TIMESTAMP,
           rejection_reason = NULL
       WHERE supplier_id = ?`,
      [supplierId]
    );

    await db.query(
      `UPDATE users
       SET verification_status = 'PENDING_SUPPLIER_VERIFICATION'
       WHERE id = ?`,
      [supplierId]
    );

    await db.query(
      `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
       VALUES (?, 'SUPPLIER', 'VERIFIED_SUPPLIER_RE_REVIEW_TRIGGERED', 'supplier_profiles', ?, ?)`,
      [supplierId, supplierId, JSON.stringify({ reason: 'Material profile changes by verified supplier', changes: materialChanges })]
    );
  }
}

module.exports = new SupplierProfileRepository();
