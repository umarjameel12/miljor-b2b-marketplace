// =============================================================================
// src/repositories/supplierProfileRepository.js
// MilJor Package E1: Supplier Profile & Verification Repository
// Handles persistence for supplier business profiles, banking, and verification state
// =============================================================================
const jwt = require('jsonwebtoken');
const defaultDb = require('../config/db');
const encryptionService = require('../services/encryptionService');
const validationService = require('../services/supplierValidationService');

// Module-private registry of cryptographically verified, one-time maintenance capabilities.
// Prevents any caller from forging a plain object with { source, actorRole, adminId } to bypass authorization.
const issuedMaintenanceCapabilities = new WeakSet();
const JWT_ISSUER = 'miljor-api';
const JWT_AUDIENCE = 'miljor-app';

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
      profile.bank_iban_is_encrypted = encryptionService.isEncrypted(profile.bank_iban);
      if (profile.bank_iban_is_encrypted) {
        try {
          // Normal application path: strictly decrypts authenticated v1 envelopes
          profile.bank_iban = encryptionService.decrypt(profile.bank_iban);
        } catch (e) {
          console.error('Warning: could not decrypt bank_iban for supplier:', supplierId, e.message);
          profile.bank_iban = null;
          profile.bank_iban_decrypt_error = e.code || 'DECRYPTION_ERROR';
        }
      } else {
        // Legacy unencrypted banking record detected in normal application path
        // Normal runtime strictly refuses implicit legacy acceptance without destroying or overwriting data
        profile.bank_iban_legacy_unencrypted = true;
        profile.bank_iban = null; // Do not expose plaintext in normal runtime
        profile.bank_iban_status = 'LEGACY_MIGRATION_REQUIRED';
      }
    }

    return profile;
  }

  /**
   * Authoritatively authenticates and authorizes an administrative actor for a one-time
   * legacy banking record migration.
   * Verifies:
   *   1. Cryptographic JWT signature, issuer, and audience
   *   2. Live database account existence, active status, and SUPER_ADMIN role
   *   3. Explicit targetSupplierId (positive safe integer) and intent === 'MIGRATE_LEGACY_BANK_IBAN'
   * Mints an unforgeable one-time capability registered in module-private WeakSet.
   */
  async authorizeLegacyBankMigration({ adminToken, targetSupplierId, intent }, connection) {
    if (!adminToken || typeof adminToken !== 'string') {
      const err = new Error('Unauthorized legacy migration attempt: missing administrative authentication token.');
      err.code = 'UNAUTHORIZED_MIGRATION';
      throw err;
    }

    if (intent !== 'MIGRATE_LEGACY_BANK_IBAN') {
      const err = new Error('Unauthorized legacy migration attempt: explicit operation intent MIGRATE_LEGACY_BANK_IBAN is required.');
      err.code = 'INVALID_MIGRATION_INTENT';
      throw err;
    }

    const parsedTargetId = Number(targetSupplierId);
    if (!Number.isSafeInteger(parsedTargetId) || parsedTargetId <= 0) {
      const err = new Error('Invalid target supplier ID for legacy banking migration.');
      err.code = 'INVALID_TARGET_SUPPLIER';
      throw err;
    }

    let decoded;
    try {
      decoded = jwt.verify(adminToken, process.env.JWT_SECRET, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithms: ['HS256']
      });
    } catch {
      const err = new Error('Unauthorized legacy migration attempt: invalid or expired administrative token.');
      err.code = 'UNAUTHORIZED_MIGRATION';
      throw err;
    }

    const dbToQuery = connection || defaultDb;
    const [adminRows] = await dbToQuery.query(
      'SELECT id, role, is_verified, verification_status, buyer_trust_status FROM users WHERE id = ?',
      [decoded.id]
    );

    const liveAdmin = adminRows[0];
    if (
      !liveAdmin ||
      liveAdmin.role !== 'SUPER_ADMIN' ||
      liveAdmin.verification_status === 'BLOCKED' ||
      liveAdmin.buyer_trust_status === 'SUSPENDED'
    ) {
      const err = new Error('Unauthorized legacy migration attempt. Requires active verified SUPER_ADMIN privileges.');
      err.code = 'UNAUTHORIZED_MIGRATION';
      throw err;
    }

    const capability = Object.freeze({
      source: 'INTERNAL_ADMIN_MAINTENANCE',
      actorRole: 'SUPER_ADMIN',
      adminId: Number(liveAdmin.id),
      targetSupplierId: parsedTargetId,
      intent: 'MIGRATE_LEGACY_BANK_IBAN',
      issuedAt: Date.now()
    });

    issuedMaintenanceCapabilities.add(capability);
    return capability;
  }

  /**
   * Explicit server-side administrative legacy migration procedure.
   * Strictly isolated from normal application runtime paths and public APIs.
   * Rejects forged plain objects; requires a capability minted by authorizeLegacyBankMigration().
   * Strictly and unconditionally blocks mutations against miljor_db or miljor_sandbox_db.
   */
  async migrateLegacyBankingRecord(supplierId, authorizationContext, connection) {
    // 1. Reject forged objects: capability MUST exist in module-private WeakSet
    if (
      !authorizationContext ||
      typeof authorizationContext !== 'object' ||
      !issuedMaintenanceCapabilities.has(authorizationContext) ||
      authorizationContext.source !== 'INTERNAL_ADMIN_MAINTENANCE' ||
      authorizationContext.actorRole !== 'SUPER_ADMIN' ||
      authorizationContext.intent !== 'MIGRATE_LEGACY_BANK_IBAN' ||
      !Number.isSafeInteger(authorizationContext.adminId)
    ) {
      const err = new Error('Unauthorized legacy migration attempt. Requires cryptographically verified maintenance capability with SUPER_ADMIN privileges; forged context objects are rejected.');
      err.code = 'UNAUTHORIZED_MIGRATION';
      throw err;
    }

    const parsedSupplierId = Number(supplierId);
    if (!Number.isSafeInteger(parsedSupplierId) || parsedSupplierId <= 0 || authorizationContext.targetSupplierId !== parsedSupplierId) {
      const err = new Error('Target supplier mismatch or invalid supplier ID in legacy migration capability.');
      err.code = 'TARGET_SUPPLIER_MISMATCH';
      throw err;
    }

    // Consume one-time capability so it cannot be replayed
    issuedMaintenanceCapabilities.delete(authorizationContext);

    // 2. Database safety guard: strictly and unconditionally block migration on miljor_db and miljor_sandbox_db
    // Environment flags (such as ALLOW_DEV_DB_MIGRATION) cannot bypass this protection.
    const dbToQuery = connection || defaultDb;
    const [dbRow] = await dbToQuery.query('SELECT DATABASE() as current_db');
    const activeDb = dbRow[0]?.current_db;
    if (activeDb === 'miljor_db' || activeDb === 'miljor_sandbox_db' || activeDb !== 'miljor_test_db') {
      const err = new Error(`CRITICAL SAFETY INVARIANT: Legacy banking migration is strictly blocked against '${activeDb}'. Development database is strictly read-only.`);
      err.code = 'DEV_DB_MIGRATION_BLOCKED';
      throw err;
    }

    // 3. Encryption key verification before starting transaction
    if (!encryptionService.isConfigured()) {
      const err = new Error('Cannot execute legacy banking migration: BANK_DATA_ENCRYPTION_KEY is unconfigured or invalid.');
      err.code = 'ENCRYPTION_KEY_NOT_CONFIGURED';
      throw err;
    }

    // 4. Controlled Transaction Boundaries with Row-Level Lock
    const isExternalTx = Boolean(connection);
    const conn = connection || (await defaultDb.getConnection());
    try {
      if (!isExternalTx) {
        await conn.beginTransaction();
      }

      // Re-verify active SUPER_ADMIN inside authoritative transaction boundary
      const [adminCheck] = await conn.query(
        'SELECT id, role, verification_status, buyer_trust_status FROM users WHERE id = ? FOR SHARE',
        [authorizationContext.adminId]
      );
      if (
        !adminCheck[0] ||
        adminCheck[0].role !== 'SUPER_ADMIN' ||
        adminCheck[0].verification_status === 'BLOCKED' ||
        adminCheck[0].buyer_trust_status === 'SUSPENDED'
      ) {
        const err = new Error('Administrative actor is no longer active or authorized inside transaction.');
        err.code = 'UNAUTHORIZED_MIGRATION';
        throw err;
      }

      // Verify target supplier exists in users table
      const [suppUserCheck] = await conn.query(
        'SELECT id, role FROM users WHERE id = ? FOR SHARE',
        [parsedSupplierId]
      );
      if (!suppUserCheck[0] || suppUserCheck[0].role !== 'SUPPLIER') {
        const err = new Error('Target supplier account does not exist or is not a valid SUPPLIER.');
        err.code = 'TARGET_SUPPLIER_NOT_FOUND';
        throw err;
      }

      // Exclusive row-level lock to prevent races with concurrent profile updates
      const [rows] = await conn.query(
        'SELECT supplier_id, bank_iban FROM supplier_profiles WHERE supplier_id = ? FOR UPDATE',
        [parsedSupplierId]
      );

      if (!rows[0] || !rows[0].bank_iban) {
        if (!isExternalTx) await conn.commit();
        return { migrated: false, reason: 'NO_RECORD' };
      }

      const rawVal = rows[0].bank_iban;

      // 5. Idempotent check: if already encrypted envelope, no-op safely
      if (encryptionService.isEncrypted(rawVal)) {
        if (!isExternalTx) await conn.commit();
        return { migrated: false, reason: 'ALREADY_ENCRYPTED' };
      }

      // 6. Explicit authorized legacy read and validation before encryption
      const plaintext = encryptionService.decrypt(rawVal, { allowLegacy: true });
      const ibanValidation = validationService.validateIban(plaintext);
      if (!ibanValidation.valid) {
        const err = new Error('Legacy migration failed: unencrypted record does not contain a valid Pakistani IBAN.');
        err.code = 'INVALID_LEGACY_IBAN';
        throw err;
      }

      // 7. Re-encrypt with active key
      const encrypted = encryptionService.encrypt(plaintext);

      await conn.query(
        'UPDATE supplier_profiles SET bank_iban = ? WHERE supplier_id = ?',
        [encrypted, parsedSupplierId]
      );

      // 8. Persist audit log without leaking plaintext
      await conn.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, ?, 'LEGACY_BANK_DATA_MIGRATED', 'supplier_profiles', ?, ?, ?)`,
        [
          authorizationContext.adminId,
          authorizationContext.actorRole,
          parsedSupplierId,
          JSON.stringify({ status: 'LEGACY_PLAINTEXT_REDACTED', intent: authorizationContext.intent }),
          JSON.stringify({ status: 'ENCRYPTED_AT_REST_V1' })
        ]
      );

      if (!isExternalTx) {
        await conn.commit();
      }

      return { migrated: true, supplierId: parsedSupplierId };
    } catch (err) {
      if (!isExternalTx) {
        await conn.rollback();
      }
      throw err;
    } finally {
      if (!isExternalTx) {
        conn.release();
      }
    }
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
