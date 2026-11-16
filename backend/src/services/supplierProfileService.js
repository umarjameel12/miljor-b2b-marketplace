// =============================================================================
// src/services/supplierProfileService.js
// MilJor Package E1: Supplier Profile & Verification Service
// Handles business logic for onboarding, validation, draft saves, and verification submissions
// =============================================================================
const defaultDb = require('../config/db');
const crypto = require('node:crypto');
const supplierProfileRepo = require('../repositories/supplierProfileRepository');
const validationService = require('./supplierValidationService');
const supplierEvidence = require('./supplierVerificationDocumentService');

class SupplierProfileService {
  _asJson(value, fallback) {
    if(value == null) return fallback;
    if(typeof value === 'string') {
      try { return JSON.parse(value); } catch { return fallback; }
    }
    return value;
  }

  // Never persist raw bank identifiers, encryption envelopes or bank account numbers
  // in a secondary review snapshot; the authoritative encrypted profile remains separate.
  _reviewSnapshot(profile) {
    const allowed = ['business_name','business_type','business_description',
      'contact_person_name','contact_person_phone','warehouse_address','lahore_service_area',
      'tax_ntn','food_license_no','food_license_type','bank_name','bank_account_title'];
    const result = {};
    for (const key of allowed) result[key] = profile[key] ?? null;
    result.bank_iban_masked = validationService.maskIban(profile.bank_iban);
    result.has_bank_details = Boolean(profile.bank_iban);
    return result;
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
      submitted_revision: Number(profile.submitted_revision || 0),
      correction_fields: this._asJson(profile.correction_fields, []),
      correction_notes: this._asJson(profile.correction_notes, {}),
      correction_requested_at: profile.correction_requested_at || null,
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

      // Serialize profile edits with review decisions and initial submissions.
      await supplierProfileRepo.lockForUpdate(supplierId, connection);
      const currentProfile = await supplierProfileRepo.findBySupplierId(supplierId, connection);
      if (['PENDING_REVIEW', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED', 'REJECTED'].includes(currentProfile.verification_status)) {
        const err = new Error('The submitted application is locked. Corrections require a specific administrative request.');
        err.code = 'VERIFICATION_PROFILE_LOCKED';
        err.statusCode = 409;
        throw err;
      }

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
    await supplierProfileRepo.ensureProfileExists(supplierId);
    const connection = await defaultDb.getConnection();
    try {
      await connection.beginTransaction();
      await supplierProfileRepo.lockForUpdate(supplierId, connection);
      const profile = await supplierProfileRepo.findBySupplierId(supplierId, connection);
      if (['PENDING_REVIEW','UNDER_REVIEW'].includes(profile.verification_status)) {
        await connection.commit();
        return { success:true,alreadyPending:true, verification_status:profile.verification_status,
          submitted_at:profile.submitted_at, submitted_revision:Number(profile.submitted_revision||0),
          message:'Your existing application is awaiting administrative review.' };
      }
      if(profile.verification_status==='VERIFIED') {
        await connection.commit();
        return {success:true,alreadyVerified:true,verification_status:'VERIFIED',
          verified_at:profile.verified_at,message:'Your supplier account is already verified.'};
      }
      if(!['NOT_SUBMITTED',null,undefined].includes(profile.verification_status)) {
        const err=Object.assign(new Error('Application is locked. Corrections or appeals require the designated workflow.'),
          {code:'VERIFICATION_STATE_LOCKED',statusCode:409});throw err;
      }
      const check = validationService.validateProfileData({
        business_name:profile.business_name,business_type:profile.business_type,
        contact_person_name:profile.contact_person_name,contact_person_phone:profile.contact_person_phone,
        warehouse_address:profile.warehouse_address,lahore_service_area:profile.lahore_service_area,
        bank_name:profile.bank_name,bank_account_title:profile.bank_account_title,
        bank_iban:profile.bank_iban,tax_ntn:profile.tax_ntn,
        food_license_no:profile.food_license_no,food_license_type:profile.food_license_type
      },true);
      if(!check.valid)throw Object.assign(new Error('Cannot submit incomplete profile: '+check.errors.join('; ')),
        {code:'INCOMPLETE_PROFILE',statusCode:400,details:check.errors});
      const revision=Number(profile.submitted_revision||0)+1;
      await connection.query(
        `UPDATE supplier_profiles SET verification_status='PENDING_REVIEW',submitted_at=UTC_TIMESTAMP(),
           submitted_revision=?,correction_fields=NULL,correction_notes=NULL,
           correction_requested_revision=NULL,correction_requested_at=NULL,rejection_reason=NULL
         WHERE supplier_id=?`,[revision,supplierId]);
      await connection.query(
        "UPDATE users SET verification_status='PENDING_SUPPLIER_VERIFICATION' WHERE id=?",
        [supplierId]);
      const firstSnapshot=this._reviewSnapshot(profile);
      firstSnapshot.documents=await supplierEvidence.latest(supplierId,connection);
      await connection.query(
        `INSERT INTO supplier_verification_revisions
           (supplier_id,revision,submitted_snapshot) VALUES (?,?,?)`,
        [supplierId,revision,JSON.stringify(firstSnapshot)]);
      await connection.query(
        `INSERT INTO system_audit_logs (actor_id,actor_role,action,entity_name,entity_id,new_value)
         VALUES (?,'SUPPLIER','SUPPLIER_VERIFICATION_SUBMITTED','supplier_profiles',?,?)`,
        [supplierId,supplierId,JSON.stringify({status:'PENDING_REVIEW',revision})]);
      const [rows]=await connection.query('SELECT submitted_at FROM supplier_profiles WHERE supplier_id=?',[supplierId]);
      await connection.commit();
      return {success:true,verification_status:'PENDING_REVIEW',submitted_at:rows[0]?.submitted_at,
        submitted_revision:revision,message:'Application submitted. Your business details are awaiting administrative review.'};
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }

  async getVerificationHistory(supplierId) {
    if(!Number.isSafeInteger(Number(supplierId)) || Number(supplierId)<=0)
      throw Object.assign(new Error('Invalid supplier id'),{code:'INVALID_SUPPLIER',statusCode:400});
    const [rows]=await defaultDb.query(
      `SELECT revision,submitted_at,review_action,reviewed_at,review_reason
       FROM supplier_verification_revisions WHERE supplier_id=?
       ORDER BY revision DESC LIMIT 50`,[supplierId]);
    // No document contents, banking details or private reviewer identities in the timeline.
    return rows;
  }

  async submitCorrections(supplierId, payload = {}, rawKey) {
    if(!rawKey || typeof rawKey!=='string' || !/^[A-Za-z0-9:_-]{12,120}$/.test(rawKey)) {
      throw Object.assign(new Error('Valid X-Idempotency-Key is required for corrections.'),
        {code:'INVALID_IDEMPOTENCY_KEY',statusCode:400});
    }
    if(!payload || typeof payload!=='object' || Array.isArray(payload) ||
       !payload.changes || typeof payload.changes!=='object' || Array.isArray(payload.changes)) {
      throw Object.assign(new Error('Field-scoped changes object required.'),
        {code:'INVALID_CORRECTION_PAYLOAD',statusCode:400});
    }
    const canonicalChanges=Object.fromEntries(Object.entries(payload.changes)
      .sort(([a],[b])=>a.localeCompare(b)));
    const replayHash=crypto.createHash('sha256')
      .update(JSON.stringify({expected_revision:payload.expected_revision,changes:canonicalChanges}))
      .digest('hex');
    const connection=await defaultDb.getConnection();
    try{
      await connection.beginTransaction();
      await supplierProfileRepo.lockForUpdate(supplierId,connection);
      const profile=await supplierProfileRepo.findBySupplierId(supplierId,connection);
      if(!profile)throw Object.assign(new Error('Supplier profile missing'),{code:'NOT_FOUND',statusCode:404});
      if(profile.verification_status==='PENDING_REVIEW' &&
         profile.last_correction_key===rawKey &&
         Number(profile.last_correction_revision)===Number(profile.submitted_revision)) {
        if(profile.last_correction_hash!==replayHash)
          throw Object.assign(new Error('Correction key was reused with different values'),
            {code:'IDEMPOTENCY_CONFLICT',statusCode:409});
        await connection.commit();
        return {success:true,alreadyPending:true,submitted_revision:Number(profile.submitted_revision),
          verification_status:'PENDING_REVIEW'};
      }
      if(profile.verification_status!=='MORE_INFORMATION_REQUIRED') {
        throw Object.assign(new Error('No open correction request'),{code:'NO_OPEN_CORRECTION',statusCode:409});
      }
      if(Number(payload.expected_revision)!==Number(profile.submitted_revision) ||
         Number(profile.correction_requested_revision)!==Number(profile.submitted_revision)) {
        throw Object.assign(new Error('Correction request is stale. Refresh the application.'),{code:'STALE_CORRECTION',statusCode:409});
      }
      const fields=this._asJson(profile.correction_fields,[]);
      const textFields=fields.filter(x=>typeof x==='string'&&!x.startsWith('document:'));
      const documentFields=fields.filter(x=>typeof x==='string'&&x.startsWith('document:'));
      const changed=Object.keys(payload.changes);
      if(!Array.isArray(fields)||!fields.length||changed.length!==textFields.length ||
        changed.some(k=>!textFields.includes(k)) ||
        textFields.some(k=>!Object.prototype.hasOwnProperty.call(payload.changes,k))) {
        throw Object.assign(new Error('Submit only the exact fields requested by the administrator.'),
          {code:'CORRECTION_FIELDS_MISMATCH',statusCode:400});
      }
      if(changed.some(field=>typeof payload.changes[field]!=='string')) {
        throw Object.assign(new Error('Correction values must be strings'),
          {code:'INVALID_CORRECTION_VALUES',statusCode:400});
      }
      const docVersions=await supplierEvidence.latest(supplierId,connection);
      for(const token of documentFields){
        const kind=token.slice('document:'.length);
        const doc=docVersions.find(d=>d.kind===kind);
        if(!doc || doc.review_revision!==Number(profile.submitted_revision))
          throw Object.assign(new Error('Upload a fresh replacement for each requested document'),
            {code:'DOCUMENT_CORRECTION_REQUIRED',statusCode:409});
      }
      const validation=validationService.validateProfileData(payload.changes,false);
      if(!validation.valid || changed.some(k=>!Object.prototype.hasOwnProperty.call(validation.sanitized,k))) {
        throw Object.assign(new Error((validation.errors||[]).join('; ')||'Invalid correction fields'),
          {code:'INVALID_CORRECTION_VALUES',statusCode:400});
      }
      await supplierProfileRepo.updateProfileDetails(supplierId,validation.sanitized,connection);
      const updated=await supplierProfileRepo.findBySupplierId(supplierId,connection);
      const revision=Number(profile.submitted_revision)+1;
      await connection.query(
        `UPDATE supplier_profiles SET submitted_revision=?,submitted_at=UTC_TIMESTAMP(),
            verification_status='PENDING_REVIEW',correction_fields=NULL,correction_notes=NULL,
            correction_requested_revision=NULL,correction_requested_at=NULL,rejection_reason=NULL,
            last_correction_key=?,last_correction_hash=?,last_correction_revision=?
           WHERE supplier_id=?`,[revision,rawKey,replayHash,revision,supplierId]);
      const correctedSnapshot=this._reviewSnapshot(updated);
      correctedSnapshot.documents=docVersions;
      await connection.query(
        `INSERT INTO supplier_verification_revisions
           (supplier_id,revision,submitted_snapshot,submission_key) VALUES (?,?,?,?)`,
        [supplierId,revision,JSON.stringify(correctedSnapshot),rawKey]);
      await connection.query(
        `INSERT INTO system_audit_logs (actor_id,actor_role,action,entity_name,entity_id,new_value)
         VALUES (?,'SUPPLIER','SUPPLIER_VERIFICATION_CORRECTED','supplier_profiles',?,?)`,
        [supplierId,supplierId,JSON.stringify({revision,corrected_fields:changed})]);
      await connection.commit();
      return {success:true,verification_status:'PENDING_REVIEW',submitted_revision:revision};
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
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
      submitted_revision:Number(profile.submitted_revision||0),
      correction_fields:this._asJson(profile.correction_fields,[]),
      correction_notes:this._asJson(profile.correction_notes,{}),
      submitted_at: profile.submitted_at || null,
      verified_at: profile.verified_at || null
    };
  }
}

module.exports = new SupplierProfileService();
