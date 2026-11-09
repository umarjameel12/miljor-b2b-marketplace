// =============================================================================
// src/services/catalogService.js
// MilJor Canonical Catalog & Moderation Domain Service (Package E2)
// =============================================================================
const db = require('../config/db');
const catalogRepo = require('../repositories/catalogRepository');
const productRepo = require('../repositories/productRepo');
const productSpecRepo = require('../repositories/productSpecificationRepo');
const specificationService = require('./specificationService');

class CatalogService {
  // ---------------------------------------------------------------------------
  // Helper: Generate unique request code
  // ---------------------------------------------------------------------------
  _generateRequestCode(requestType) {
    const prefix = requestType === 'NEW_FAMILY' ? 'REQ-FAM' : 'REQ-VAR';
    const ts = Date.now().toString(36).toUpperCase().slice(-5);
    const rand = Math.floor(100 + Math.random() * 900);
    return `${prefix}-${ts}-${rand}`;
  }

  _generateFamilyCode(slug) {
    const clean = (slug || 'item')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
    const rand = Math.floor(10 + Math.random() * 90);
    return `FAM-${clean}-${rand}`;
  }

  _generateCategoryCode(slug) {
    const clean = (slug || 'cat')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
    const rand = Math.floor(10 + Math.random() * 90);
    return `CAT-${clean}-${rand}`;
  }

  // ---------------------------------------------------------------------------
  // 1.Ensure Family Has Base Product Row (for backward-compatible FK on product_specifications)
  // ---------------------------------------------------------------------------
  async ensureDefaultProductForFamily(family, connection = null) {
    const executor = connection || db;
    if (family.default_product_id) {
      const existing = await productRepo.findById(family.default_product_id, executor);
      if (existing) return existing;
    }

    // Check if any product already points to this family_id
    const [existingRows] = await executor.query(
      `SELECT * FROM products WHERE family_id = ? ORDER BY id ASC LIMIT 1`,
      [family.id]
    );
    if (existingRows[0]) {
      await catalogRepo.updateFamily(family.id, { default_product_id: existingRows[0].id }, executor);
      return existingRows[0];
    }

    // Create a canonical base product linked to this family & category
    const primaryUnit = Array.isArray(family.allowed_pack_units) && family.allowed_pack_units.length > 0
      ? family.allowed_pack_units[0]
      : 'kg';

    const newProductId = await productRepo.create(
      {
        title: family.name,
        category: family.category_name || 'General Food',
        category_id: family.category_id,
        family_id: family.id,
        canonical_slug: family.slug,
        brand: 'Standard Commercial',
        variety: family.name,
        processing_type: 'Standard',
        grade: 'Commercial Grade A',
        pack_size: primaryUnit === 'L' ? 16 : 25,
        unit: primaryUnit,
        approval_status: 'APPROVED',
        mapping_status: 'MAPPED_CANONICAL'
      },
      executor
    );

    await catalogRepo.updateFamily(family.id, { default_product_id: newProductId }, executor);
    return productRepo.findById(newProductId, executor);
  }

  // ---------------------------------------------------------------------------
  // 2. SUPPLIER: Create or Save Catalog Request (NEW_FAMILY or NEW_VARIANT)
  // ---------------------------------------------------------------------------
  async createSupplierCatalogRequest(supplierId, payload, actorRole = 'SUPPLIER') {
    const {
      request_type,
      category_id,
      family_id,
      proposed_family_name,
      brand,
      variety,
      crop_year,
      processing_method,
      quality_grade,
      packaging_type,
      pack_size,
      pack_unit,
      purchasing_unit,
      spec_attributes,
      supporting_notes,
      save_as_draft = false
    } = payload || {};

    const reqType = String(request_type || '').trim().toUpperCase();
    if (!['NEW_FAMILY', 'NEW_VARIANT'].includes(reqType)) {
      const err = new Error('request_type must be either NEW_FAMILY or NEW_VARIANT.');
      err.status = 400;
      err.code = 'INVALID_REQUEST_TYPE';
      throw err;
    }

    if (!category_id || !Number.isInteger(Number(category_id)) || Number(category_id) <= 0) {
      const err = new Error('Valid category_id is required.');
      err.status = 400;
      err.code = 'INVALID_CATEGORY';
      throw err;
    }

    const category = await catalogRepo.findCategoryById(Number(category_id));
    if (!category || !category.is_active || category.approval_status !== 'APPROVED') {
      const err = new Error('Selected category does not exist or is inactive.');
      err.status = 400;
      err.code = 'INACTIVE_OR_MISSING_CATEGORY';
      throw err;
    }

    const targetStatus = save_as_draft ? 'DRAFT' : 'SUBMITTED';

    if (reqType === 'NEW_FAMILY') {
      const cleanFamilyName = specificationService.normalizeText(proposed_family_name);
      if (!cleanFamilyName || cleanFamilyName.length < 2 || cleanFamilyName.length > 100) {
        const err = new Error('proposed_family_name is required (2–100 characters) for NEW_FAMILY requests.');
        err.status = 400;
        err.code = 'VALIDATION_ERROR';
        throw err;
      }

      const proposedSlug = specificationService.slugify(cleanFamilyName);
      if (!proposedSlug) {
        const err = new Error('proposed_family_name must contain alphanumeric characters.');
        err.status = 400;
        err.code = 'VALIDATION_ERROR';
        throw err;
      }

      // Check if canonical family already exists
      const existingFamily = await catalogRepo.findFamilyBySlugOrName(proposedSlug, category.id, cleanFamilyName);
      if (existingFamily) {
        const err = new Error(`Product family '${existingFamily.name}' already exists in canonical catalog.`);
        err.status = 409;
        err.code = 'DUPLICATE_CANONICAL_FAMILY';
        err.existingFamily = existingFamily;
        throw err;
      }

      const dedupHash = specificationService.computeCatalogRequestHash({
        requestType: 'NEW_FAMILY',
        categoryId: category.id,
        proposedFamilyName: cleanFamilyName
      });

      if (targetStatus === 'SUBMITTED') {
        const activeDup = await catalogRepo.findActiveDuplicateRequest(dedupHash);
        if (activeDup) {
          const err = new Error('An identical product family request is already pending or approved.');
          err.status = 409;
          err.code = 'DUPLICATE_CATALOG_REQUEST';
          err.existingRequest = activeDup;
          throw err;
        }
      }

      const normalizedPayload = {
        request_type: 'NEW_FAMILY',
        category_id: category.id,
        category_name: category.name,
        proposed_family_name: cleanFamilyName,
        proposed_family_slug: proposedSlug,
        allowed_pack_units: Array.isArray(payload.allowed_pack_units) ? payload.allowed_pack_units : ['kg', 'g'],
        allowed_purchasing_units: Array.isArray(payload.allowed_purchasing_units) ? payload.allowed_purchasing_units : ['bag', 'sack']
      };

      const created = await catalogRepo.createCatalogRequest({
        request_code: this._generateRequestCode('NEW_FAMILY'),
        supplier_id: supplierId,
        request_type: 'NEW_FAMILY',
        category_id: category.id,
        family_id: null,
        proposed_family_name: cleanFamilyName,
        proposed_family_slug: proposedSlug,
        proposed_variant_title: null,
        normalized_payload: normalizedPayload,
        supporting_notes: supporting_notes ? specificationService.normalizeText(supporting_notes) : null,
        dedup_hash: dedupHash,
        status: targetStatus
      });

      await catalogRepo.insertModerationLog({
        request_id: created.id,
        entity_type: 'CATALOG_REQUEST',
        entity_id: created.id,
        actor_id: supplierId,
        actor_role: actorRole,
        from_status: null,
        to_status: targetStatus,
        action: targetStatus === 'DRAFT' ? 'SAVE_DRAFT_FAMILY_REQUEST' : 'SUBMIT_FAMILY_REQUEST',
        metadata: { request_code: created.request_code, proposed_family_name: cleanFamilyName }
      });

      return created;
    }

    // Otherwise: NEW_VARIANT
    if (!family_id || !Number.isInteger(Number(family_id)) || Number(family_id) <= 0) {
      const err = new Error('Valid family_id is required when requesting a NEW_VARIANT.');
      err.status = 400;
      err.code = 'INVALID_FAMILY';
      throw err;
    }

    const family = await catalogRepo.findFamilyById(Number(family_id));
    if (!family || !family.is_active || family.approval_status !== 'APPROVED') {
      const err = new Error('Selected product family does not exist or is inactive.');
      err.status = 400;
      err.code = 'INACTIVE_OR_MISSING_FAMILY';
      throw err;
    }

    // Strict hierarchy check: family MUST belong to selected category
    if (Number(family.category_id) !== Number(category.id)) {
      const err = new Error(`Product family '${family.name}' does not belong to category '${category.name}'.`);
      err.status = 400;
      err.code = 'CATEGORY_FAMILY_MISMATCH';
      throw err;
    }

    const cleanBrand = specificationService.normalizeText(brand);
    const cleanVariety = specificationService.normalizeText(variety);
    const cleanCropYear = specificationService.normalizeText(crop_year || 'N/A') || 'N/A';
    const cleanProcessing = specificationService.normalizeText(processing_method || 'Standard') || 'Standard';
    const cleanGrade = specificationService.normalizeText(quality_grade || 'Standard') || 'Standard';
    const cleanPackaging = specificationService.normalizeText(packaging_type);
    const cleanPurchasingUnit = specificationService.normalizeText(purchasing_unit || 'bag').toLowerCase() || 'bag';

    const validation = specificationService.validateSpecificationInput(
      {
        product_id: family.default_product_id || family.id,
        brand: cleanBrand,
        variety: cleanVariety,
        crop_year: cleanCropYear,
        processing_method: cleanProcessing,
        quality_grade: cleanGrade,
        packaging_type: cleanPackaging,
        pack_size,
        pack_unit,
        purchasing_unit: cleanPurchasingUnit,
        spec_attributes
      },
      category.name,
      family
    );

    if (!validation.valid) {
      const err = new Error(validation.message);
      err.status = 400;
      err.code = validation.code || 'SPECIFICATION_VALIDATION_ERROR';
      throw err;
    }

    const normalizedPackSize = validation.normalizedPackSize;
    const normalizedPackUnit = validation.normalizedPackUnit;
    const normalizedAttributes = validation.normalizedAttributes;

    // Check if an identical approved physical variant already exists under this family's base product
    const baseProd = await this.ensureDefaultProductForFamily(family);
    const candidateSpecHash = specificationService.computeSpecHash({
      productId: baseProd.id,
      brand: cleanBrand,
      variety: cleanVariety,
      cropYear: cleanCropYear,
      processingMethod: cleanProcessing,
      qualityGrade: cleanGrade,
      packagingType: cleanPackaging,
      packSize: normalizedPackSize,
      packUnit: normalizedPackUnit,
      purchasingUnit: cleanPurchasingUnit,
      specAttributes: normalizedAttributes
    });

    const existingSpec = await productSpecRepo.findByHash(candidateSpecHash);
    if (existingSpec) {
      const err = new Error('An identical physical variant already exists in the approved catalog.');
      err.status = 409;
      err.code = 'DUPLICATE_APPROVED_VARIANT';
      err.existingSpecification = existingSpec;
      throw err;
    }

    const dedupHash = specificationService.computeCatalogRequestHash({
      requestType: 'NEW_VARIANT',
      categoryId: category.id,
      familyId: family.id,
      brand: cleanBrand,
      variety: cleanVariety,
      cropYear: cleanCropYear,
      processingMethod: cleanProcessing,
      qualityGrade: cleanGrade,
      packagingType: cleanPackaging,
      packSize: normalizedPackSize,
      packUnit: normalizedPackUnit,
      purchasingUnit: cleanPurchasingUnit,
      specAttributes: normalizedAttributes
    });

    if (targetStatus === 'SUBMITTED') {
      const activeDup = await catalogRepo.findActiveDuplicateRequest(dedupHash);
      if (activeDup) {
        const err = new Error('An identical physical variant request is already pending or approved.');
        err.status = 409;
        err.code = 'DUPLICATE_CATALOG_REQUEST';
        err.existingRequest = activeDup;
        throw err;
      }
    }

    const variantTitle = `${cleanBrand} ${family.name} — ${cleanVariety} (${cleanGrade}) — ${normalizedPackSize}${normalizedPackUnit} ${cleanPackaging}`;

    const normalizedPayload = {
      request_type: 'NEW_VARIANT',
      category_id: category.id,
      category_name: category.name,
      family_id: family.id,
      family_name: family.name,
      brand: cleanBrand,
      variety: cleanVariety,
      crop_year: cleanCropYear,
      processing_method: cleanProcessing,
      quality_grade: cleanGrade,
      packaging_type: cleanPackaging,
      pack_size: normalizedPackSize,
      pack_unit: normalizedPackUnit,
      purchasing_unit: cleanPurchasingUnit,
      spec_attributes: normalizedAttributes
    };

    const created = await catalogRepo.createCatalogRequest({
      request_code: this._generateRequestCode('NEW_VARIANT'),
      supplier_id: supplierId,
      request_type: 'NEW_VARIANT',
      category_id: category.id,
      family_id: family.id,
      proposed_family_name: null,
      proposed_family_slug: null,
      proposed_variant_title: variantTitle,
      brand: cleanBrand,
      variety: cleanVariety,
      crop_year: cleanCropYear,
      processing_method: cleanProcessing,
      quality_grade: cleanGrade,
      packaging_type: cleanPackaging,
      pack_size: normalizedPackSize,
      pack_unit: normalizedPackUnit,
      purchasing_unit: cleanPurchasingUnit,
      spec_attributes: normalizedAttributes,
      normalized_payload: normalizedPayload,
      supporting_notes: supporting_notes ? specificationService.normalizeText(supporting_notes) : null,
      dedup_hash: dedupHash,
      status: targetStatus
    });

    await catalogRepo.insertModerationLog({
      request_id: created.id,
      entity_type: 'CATALOG_REQUEST',
      entity_id: created.id,
      actor_id: supplierId,
      actor_role: actorRole,
      from_status: null,
      to_status: targetStatus,
      action: targetStatus === 'DRAFT' ? 'SAVE_DRAFT_VARIANT_REQUEST' : 'SUBMIT_VARIANT_REQUEST',
      metadata: { request_code: created.request_code, proposed_variant_title: variantTitle }
    });

    return created;
  }

  // ---------------------------------------------------------------------------
  // 3. SUPPLIER: Update / Resubmit Rejected or Draft Catalog Request
  // ---------------------------------------------------------------------------
  async updateSupplierCatalogRequest(supplierId, requestId, payload, actorRole = 'SUPPLIER') {
    const existing = await catalogRepo.findCatalogRequestById(Number(requestId));
    if (!existing) {
      const err = new Error('Catalog request not found.');
      err.status = 404;
      err.code = 'REQUEST_NOT_FOUND';
      throw err;
    }

    if (Number(existing.supplier_id) !== Number(supplierId)) {
      const err = new Error('You are not authorized to access or modify another supplier\'s catalog request.');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    if (!['DRAFT', 'REJECTED'].includes(existing.status)) {
      const err = new Error(`Catalog request in status '${existing.status}' cannot be edited by supplier.`);
      err.status = 409;
      err.code = 'INVALID_STATE_TRANSITION';
      throw err;
    }

    const reqType = existing.request_type;
    const categoryId = payload.category_id !== undefined ? Number(payload.category_id) : Number(existing.category_id);
    const category = await catalogRepo.findCategoryById(categoryId);
    if (!category || !category.is_active || category.approval_status !== 'APPROVED') {
      const err = new Error('Selected category does not exist or is inactive.');
      err.status = 400;
      err.code = 'INACTIVE_OR_MISSING_CATEGORY';
      throw err;
    }

    const targetStatus = payload.save_as_draft ? 'DRAFT' : 'SUBMITTED';

    if (reqType === 'NEW_FAMILY') {
      const cleanFamilyName = specificationService.normalizeText(
        payload.proposed_family_name !== undefined ? payload.proposed_family_name : existing.proposed_family_name
      );
      if (!cleanFamilyName || cleanFamilyName.length < 2) {
        const err = new Error('proposed_family_name is required (minimum 2 characters).');
        err.status = 400;
        err.code = 'VALIDATION_ERROR';
        throw err;
      }

      const proposedSlug = specificationService.slugify(cleanFamilyName);
      const existingFamily = await catalogRepo.findFamilyBySlugOrName(proposedSlug, category.id, cleanFamilyName);
      if (existingFamily) {
        const err = new Error(`Product family '${existingFamily.name}' already exists in canonical catalog.`);
        err.status = 409;
        err.code = 'DUPLICATE_CANONICAL_FAMILY';
        throw err;
      }

      const dedupHash = specificationService.computeCatalogRequestHash({
        requestType: 'NEW_FAMILY',
        categoryId: category.id,
        proposedFamilyName: cleanFamilyName
      });

      if (targetStatus === 'SUBMITTED') {
        const activeDup = await catalogRepo.findActiveDuplicateRequest(dedupHash, existing.id);
        if (activeDup) {
          const err = new Error('An identical product family request is already pending or approved.');
          err.status = 409;
          err.code = 'DUPLICATE_CATALOG_REQUEST';
          throw err;
        }
      }

      const updated = await catalogRepo.updateCatalogRequest(existing.id, {
        category_id: category.id,
        proposed_family_name: cleanFamilyName,
        proposed_family_slug: proposedSlug,
        supporting_notes: payload.supporting_notes !== undefined
          ? specificationService.normalizeText(payload.supporting_notes)
          : existing.supporting_notes,
        dedup_hash: dedupHash,
        status: targetStatus,
        submitted_at: targetStatus === 'SUBMITTED' ? new Date() : existing.submitted_at
      });

      await catalogRepo.insertModerationLog({
        request_id: existing.id,
        entity_type: 'CATALOG_REQUEST',
        entity_id: existing.id,
        actor_id: supplierId,
        actor_role: actorRole,
        from_status: existing.status,
        to_status: targetStatus,
        action: targetStatus === 'SUBMITTED' ? 'RESUBMIT_FAMILY_REQUEST' : 'UPDATE_DRAFT_FAMILY_REQUEST'
      });

      return updated;
    }

    // NEW_VARIANT update/resubmit
    const familyId = payload.family_id !== undefined ? Number(payload.family_id) : Number(existing.family_id);
    const family = await catalogRepo.findFamilyById(familyId);
    if (!family || !family.is_active || family.approval_status !== 'APPROVED') {
      const err = new Error('Selected product family does not exist or is inactive.');
      err.status = 400;
      err.code = 'INACTIVE_OR_MISSING_FAMILY';
      throw err;
    }

    if (Number(family.category_id) !== Number(category.id)) {
      const err = new Error(`Product family '${family.name}' does not belong to category '${category.name}'.`);
      err.status = 400;
      err.code = 'CATEGORY_FAMILY_MISMATCH';
      throw err;
    }

    const cleanBrand = specificationService.normalizeText(payload.brand !== undefined ? payload.brand : existing.brand);
    const cleanVariety = specificationService.normalizeText(payload.variety !== undefined ? payload.variety : existing.variety);
    const cleanCropYear = specificationService.normalizeText(payload.crop_year !== undefined ? payload.crop_year : existing.crop_year) || 'N/A';
    const cleanProcessing = specificationService.normalizeText(payload.processing_method !== undefined ? payload.processing_method : existing.processing_method) || 'Standard';
    const cleanGrade = specificationService.normalizeText(payload.quality_grade !== undefined ? payload.quality_grade : existing.quality_grade) || 'Standard';
    const cleanPackaging = specificationService.normalizeText(payload.packaging_type !== undefined ? payload.packaging_type : existing.packaging_type);
    const rawPackSize = payload.pack_size !== undefined ? payload.pack_size : existing.pack_size;
    const rawPackUnit = payload.pack_unit !== undefined ? payload.pack_unit : existing.pack_unit;
    const cleanPurchasingUnit = specificationService.normalizeText(payload.purchasing_unit !== undefined ? payload.purchasing_unit : existing.purchasing_unit).toLowerCase() || 'bag';
    const rawAttrs = payload.spec_attributes !== undefined ? payload.spec_attributes : existing.spec_attributes;

    const validation = specificationService.validateSpecificationInput(
      {
        product_id: family.default_product_id || family.id,
        brand: cleanBrand,
        variety: cleanVariety,
        crop_year: cleanCropYear,
        processing_method: cleanProcessing,
        quality_grade: cleanGrade,
        packaging_type: cleanPackaging,
        pack_size: rawPackSize,
        pack_unit: rawPackUnit,
        purchasing_unit: cleanPurchasingUnit,
        spec_attributes: rawAttrs
      },
      category.name,
      family
    );

    if (!validation.valid) {
      const err = new Error(validation.message);
      err.status = 400;
      err.code = validation.code || 'SPECIFICATION_VALIDATION_ERROR';
      throw err;
    }

    const normalizedPackSize = validation.normalizedPackSize;
    const normalizedPackUnit = validation.normalizedPackUnit;
    const normalizedAttributes = validation.normalizedAttributes;

    const dedupHash = specificationService.computeCatalogRequestHash({
      requestType: 'NEW_VARIANT',
      categoryId: category.id,
      familyId: family.id,
      brand: cleanBrand,
      variety: cleanVariety,
      cropYear: cleanCropYear,
      processingMethod: cleanProcessing,
      qualityGrade: cleanGrade,
      packagingType: cleanPackaging,
      packSize: normalizedPackSize,
      packUnit: normalizedPackUnit,
      purchasingUnit: cleanPurchasingUnit,
      specAttributes: normalizedAttributes
    });

    if (targetStatus === 'SUBMITTED') {
      const activeDup = await catalogRepo.findActiveDuplicateRequest(dedupHash, existing.id);
      if (activeDup) {
        const err = new Error('An identical physical variant request is already pending or approved.');
        err.status = 409;
        err.code = 'DUPLICATE_CATALOG_REQUEST';
        throw err;
      }
    }

    const variantTitle = `${cleanBrand} ${family.name} — ${cleanVariety} (${cleanGrade}) — ${normalizedPackSize}${normalizedPackUnit} ${cleanPackaging}`;

    const normalizedPayload = {
      request_type: 'NEW_VARIANT',
      category_id: category.id,
      category_name: category.name,
      family_id: family.id,
      family_name: family.name,
      brand: cleanBrand,
      variety: cleanVariety,
      crop_year: cleanCropYear,
      processing_method: cleanProcessing,
      quality_grade: cleanGrade,
      packaging_type: cleanPackaging,
      pack_size: normalizedPackSize,
      pack_unit: normalizedPackUnit,
      purchasing_unit: cleanPurchasingUnit,
      spec_attributes: normalizedAttributes
    };

    const updated = await catalogRepo.updateCatalogRequest(existing.id, {
      category_id: category.id,
      family_id: family.id,
      proposed_variant_title: variantTitle,
      brand: cleanBrand,
      variety: cleanVariety,
      crop_year: cleanCropYear,
      processing_method: cleanProcessing,
      quality_grade: cleanGrade,
      packaging_type: cleanPackaging,
      pack_size: normalizedPackSize,
      pack_unit: normalizedPackUnit,
      purchasing_unit: cleanPurchasingUnit,
      spec_attributes: normalizedAttributes,
      normalized_payload: normalizedPayload,
      supporting_notes: payload.supporting_notes !== undefined
        ? specificationService.normalizeText(payload.supporting_notes)
        : existing.supporting_notes,
      dedup_hash: dedupHash,
      status: targetStatus,
      submitted_at: targetStatus === 'SUBMITTED' ? new Date() : existing.submitted_at
    });

    await catalogRepo.insertModerationLog({
      request_id: existing.id,
      entity_type: 'CATALOG_REQUEST',
      entity_id: existing.id,
      actor_id: supplierId,
      actor_role: actorRole,
      from_status: existing.status,
      to_status: targetStatus,
      action: targetStatus === 'SUBMITTED' ? 'RESUBMIT_VARIANT_REQUEST' : 'UPDATE_DRAFT_VARIANT_REQUEST'
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // 4. ADMIN: Mark Catalog Request UNDER_REVIEW
  // ---------------------------------------------------------------------------
  async markRequestUnderReview(requestId, adminId, adminRole, reviewNotes = null) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const reqRow = await catalogRepo.findCatalogRequestById(Number(requestId), connection, true);
      if (!reqRow) {
        const err = new Error('Catalog request not found.');
        err.status = 404;
        err.code = 'REQUEST_NOT_FOUND';
        throw err;
      }

      if (!['SUBMITTED', 'UNDER_REVIEW'].includes(reqRow.status)) {
        const err = new Error(`Cannot transition request from '${reqRow.status}' to 'UNDER_REVIEW'.`);
        err.status = 409;
        err.code = 'INVALID_STATE_TRANSITION';
        throw err;
      }

      const updated = await catalogRepo.updateCatalogRequest(
        reqRow.id,
        {
          status: 'UNDER_REVIEW',
          review_notes: reviewNotes !== null ? reviewNotes : reqRow.review_notes,
          reviewed_by: adminId,
          reviewed_at: new Date()
        },
        connection
      );

      await catalogRepo.insertModerationLog(
        {
          request_id: reqRow.id,
          entity_type: 'CATALOG_REQUEST',
          entity_id: reqRow.id,
          actor_id: adminId,
          actor_role: adminRole,
          from_status: reqRow.status,
          to_status: 'UNDER_REVIEW',
          action: 'MARK_UNDER_REVIEW',
          reason: reviewNotes
        },
        connection
      );

      await connection.commit();
      return updated;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ---------------------------------------------------------------------------
  // 5. ADMIN: Approve Catalog Request (Atomic Creation of Canonical Family or Variant)
  // ---------------------------------------------------------------------------
  async approveCatalogRequest(requestId, adminId, adminRole, adminOverrides = {}) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const reqRow = await catalogRepo.findCatalogRequestById(Number(requestId), connection, true);
      if (!reqRow) {
        const err = new Error('Catalog request not found.');
        err.status = 404;
        err.code = 'REQUEST_NOT_FOUND';
        throw err;
      }

      if (reqRow.status === 'APPROVED') {
        await connection.commit();
        return { request: reqRow, alreadyApproved: true };
      }

      if (!['SUBMITTED', 'UNDER_REVIEW'].includes(reqRow.status)) {
        const err = new Error(`Cannot approve catalog request in status '${reqRow.status}'.`);
        err.status = 409;
        err.code = 'INVALID_STATE_TRANSITION';
        throw err;
      }

      const category = await catalogRepo.findCategoryById(reqRow.category_id, connection);
      if (!category || !category.is_active) {
        const err = new Error('Target category is inactive or missing.');
        err.status = 400;
        err.code = 'INACTIVE_OR_MISSING_CATEGORY';
        throw err;
      }

      let approvedFamily = null;
      let approvedSpec = null;

      if (reqRow.request_type === 'NEW_FAMILY') {
        const finalName = specificationService.normalizeText(adminOverrides.name || reqRow.proposed_family_name);
        const finalSlug = specificationService.slugify(finalName);

        const existingFam = await catalogRepo.findFamilyBySlugOrName(finalSlug, category.id, finalName, connection);
        if (existingFam) {
          approvedFamily = existingFam;
        } else {
          const allowedPackUnits = Array.isArray(adminOverrides.allowed_pack_units)
            ? adminOverrides.allowed_pack_units
            : (reqRow.normalized_payload?.allowed_pack_units || ['kg', 'g']);
          const allowedPurchUnits = Array.isArray(adminOverrides.allowed_purchasing_units)
            ? adminOverrides.allowed_purchasing_units
            : (reqRow.normalized_payload?.allowed_purchasing_units || ['bag', 'sack']);

          approvedFamily = await catalogRepo.createFamily(
            {
              category_id: category.id,
              family_code: this._generateFamilyCode(finalSlug),
              slug: finalSlug,
              name: finalName,
              urdu_name: adminOverrides.urdu_name || null,
              description: adminOverrides.description || reqRow.supporting_notes || `${finalName} under ${category.name}`,
              allowed_pack_units: allowedPackUnits,
              allowed_purchasing_units: allowedPurchUnits,
              approval_status: 'APPROVED',
              is_active: 1,
              created_by: adminId
            },
            connection
          );

          await this.ensureDefaultProductForFamily(approvedFamily, connection);
          approvedFamily = await catalogRepo.findFamilyById(approvedFamily.id, connection);
        }

        const updatedRequest = await catalogRepo.updateCatalogRequest(
          reqRow.id,
          {
            status: 'APPROVED',
            review_notes: adminOverrides.review_notes || 'Approved by Catalog Admin',
            reviewed_by: adminId,
            reviewed_at: new Date(),
            approved_family_id: approvedFamily.id
          },
          connection
        );

        await catalogRepo.insertModerationLog(
          {
            request_id: reqRow.id,
            entity_type: 'CATALOG_REQUEST',
            entity_id: reqRow.id,
            actor_id: adminId,
            actor_role: adminRole,
            from_status: reqRow.status,
            to_status: 'APPROVED',
            action: 'APPROVE_FAMILY_REQUEST',
            reason: adminOverrides.review_notes || null,
            metadata: { approved_family_id: approvedFamily.id, family_code: approvedFamily.family_code }
          },
          connection
        );

        await connection.commit();
        return { request: updatedRequest, approvedFamily, approvedSpec: null };
      }

      // Otherwise: Approve NEW_VARIANT
      const family = await catalogRepo.findFamilyById(reqRow.family_id, connection);
      if (!family || !family.is_active || family.approval_status !== 'APPROVED') {
        const err = new Error('Target product family is inactive or missing.');
        err.status = 400;
        err.code = 'INACTIVE_OR_MISSING_FAMILY';
        throw err;
      }

      const baseProduct = await this.ensureDefaultProductForFamily(family, connection);

      const finalBrand = specificationService.normalizeText(adminOverrides.brand || reqRow.brand);
      const finalVariety = specificationService.normalizeText(adminOverrides.variety || reqRow.variety);
      const finalCropYear = specificationService.normalizeText(adminOverrides.crop_year || reqRow.crop_year || 'N/A');
      const finalProcessing = specificationService.normalizeText(adminOverrides.processing_method || reqRow.processing_method || 'Standard');
      const finalGrade = specificationService.normalizeText(adminOverrides.quality_grade || reqRow.quality_grade || 'Standard');
      const finalPackaging = specificationService.normalizeText(adminOverrides.packaging_type || reqRow.packaging_type);
      const finalPackSize = adminOverrides.pack_size !== undefined ? Number(adminOverrides.pack_size) : Number(reqRow.pack_size);
      const finalPackUnit = specificationService.normalizeUnit(adminOverrides.pack_unit || reqRow.pack_unit);
      const finalPurchasingUnit = specificationService.normalizeText(adminOverrides.purchasing_unit || reqRow.purchasing_unit || 'bag').toLowerCase();
      const finalAttrs = specificationService.normalizeAttributes(adminOverrides.spec_attributes || reqRow.spec_attributes);

      const specHash = specificationService.computeSpecHash({
        productId: baseProduct.id,
        brand: finalBrand,
        variety: finalVariety,
        cropYear: finalCropYear,
        processingMethod: finalProcessing,
        qualityGrade: finalGrade,
        packagingType: finalPackaging,
        packSize: finalPackSize,
        packUnit: finalPackUnit,
        purchasingUnit: finalPurchasingUnit,
        specAttributes: finalAttrs
      });

      const [existingSpecRows] = await connection.query(
        `SELECT * FROM product_specifications WHERE spec_hash = ? LIMIT 1`,
        [specHash]
      );

      let specId;
      if (existingSpecRows[0]) {
        specId = existingSpecRows[0].id;
        await connection.query(
          `UPDATE product_specifications
           SET category_id = ?, family_id = ?, approval_status = 'APPROVED', is_active = 1, approved_by = ?, approved_at = NOW()
           WHERE id = ?`,
          [category.id, family.id, adminId, specId]
        );
      } else {
        const specCode = specificationService.generateSpecCode(category.name, finalVariety);
        const title = `${finalBrand} ${family.name} - ${finalVariety} (${finalGrade}) - ${finalPackSize}${finalPackUnit} ${finalPackaging}`;
        const variantTitle = `${finalBrand} — ${finalVariety} (${finalGrade}) — ${finalPackSize}${finalPackUnit} ${finalPackaging}`;

        specId = await productSpecRepo.create(
          {
            product_id: baseProduct.id,
            category_id: category.id,
            family_id: family.id,
            variant_title: variantTitle,
            spec_code: specCode,
            title,
            brand: finalBrand,
            variety: finalVariety,
            crop_year: finalCropYear,
            processing_method: finalProcessing,
            quality_grade: finalGrade,
            packaging_type: finalPackaging,
            pack_size: finalPackSize,
            pack_unit: finalPackUnit,
            purchasing_unit: finalPurchasingUnit,
            spec_attributes: finalAttrs,
            spec_hash: specHash,
            approval_status: 'APPROVED',
            created_by: reqRow.supplier_id,
            approved_by: adminId,
            approved_at: new Date()
          },
          connection
        );
      }

      approvedSpec = await catalogRepo.findVariantById(specId, connection);

      const updatedRequest = await catalogRepo.updateCatalogRequest(
        reqRow.id,
        {
          status: 'APPROVED',
          review_notes: adminOverrides.review_notes || 'Approved by Catalog Admin',
          reviewed_by: adminId,
          reviewed_at: new Date(),
          approved_family_id: family.id,
          approved_spec_id: specId
        },
        connection
      );

      await catalogRepo.insertModerationLog(
        {
          request_id: reqRow.id,
          entity_type: 'CATALOG_REQUEST',
          entity_id: reqRow.id,
          actor_id: adminId,
          actor_role: adminRole,
          from_status: reqRow.status,
          to_status: 'APPROVED',
          action: 'APPROVE_VARIANT_REQUEST',
          reason: adminOverrides.review_notes || null,
          metadata: { approved_spec_id: specId, spec_code: approvedSpec.spec_code }
        },
        connection
      );

      await connection.commit();
      return { request: updatedRequest, approvedFamily: family, approvedSpec };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ---------------------------------------------------------------------------
  // 6. ADMIN: Reject Catalog Request (Requires non-empty rejection_reason)
  // ---------------------------------------------------------------------------
  async rejectCatalogRequest(requestId, adminId, adminRole, rejectionReason, reviewNotes = null) {
    const cleanReason = specificationService.normalizeText(rejectionReason);
    if (!cleanReason || cleanReason.length < 5) {
      const err = new Error('A clear rejection_reason (minimum 5 characters) is mandatory when rejecting a catalog request.');
      err.status = 400;
      err.code = 'REJECTION_REASON_REQUIRED';
      throw err;
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const reqRow = await catalogRepo.findCatalogRequestById(Number(requestId), connection, true);
      if (!reqRow) {
        const err = new Error('Catalog request not found.');
        err.status = 404;
        err.code = 'REQUEST_NOT_FOUND';
        throw err;
      }

      if (!['SUBMITTED', 'UNDER_REVIEW'].includes(reqRow.status)) {
        const err = new Error(`Cannot reject catalog request in status '${reqRow.status}'.`);
        err.status = 409;
        err.code = 'INVALID_STATE_TRANSITION';
        throw err;
      }

      const updated = await catalogRepo.updateCatalogRequest(
        reqRow.id,
        {
          status: 'REJECTED',
          rejection_reason: cleanReason,
          review_notes: reviewNotes ? specificationService.normalizeText(reviewNotes) : reqRow.review_notes,
          reviewed_by: adminId,
          reviewed_at: new Date()
        },
        connection
      );

      await catalogRepo.insertModerationLog(
        {
          request_id: reqRow.id,
          entity_type: 'CATALOG_REQUEST',
          entity_id: reqRow.id,
          actor_id: adminId,
          actor_role: adminRole,
          from_status: reqRow.status,
          to_status: 'REJECTED',
          action: 'REJECT_CATALOG_REQUEST',
          reason: cleanReason
        },
        connection
      );

      await connection.commit();
      return updated;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ---------------------------------------------------------------------------
  // 7. ADMIN: Direct Category, Family & Variant Governance
  // ---------------------------------------------------------------------------
  async createAdminCategory(adminId, adminRole, payload) {
    const cleanName = specificationService.normalizeText(payload.name);
    if (!cleanName || cleanName.length < 2) {
      const err = new Error('Category name is required.');
      err.status = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    const slug = specificationService.slugify(payload.slug || cleanName);
    const existing = await catalogRepo.findCategoryBySlugOrName(slug, cleanName);
    if (existing) {
      const err = new Error(`Category '${cleanName}' already exists.`);
      err.status = 409;
      err.code = 'DUPLICATE_CATEGORY';
      throw err;
    }

    const created = await catalogRepo.createCategory({
      category_code: payload.category_code || this._generateCategoryCode(slug),
      slug,
      name: cleanName,
      urdu_name: payload.urdu_name || null,
      description: payload.description || null,
      display_order: payload.display_order || 100,
      is_active: payload.is_active !== undefined ? Boolean(payload.is_active) : true,
      approval_status: 'APPROVED',
      created_by: adminId
    });

    await catalogRepo.insertModerationLog({
      entity_type: 'CATEGORY',
      entity_id: created.id,
      actor_id: adminId,
      actor_role: adminRole,
      from_status: null,
      to_status: created.approval_status,
      action: 'ADMIN_CREATE_CATEGORY',
      metadata: { category_code: created.category_code, name: created.name }
    });

    return created;
  }

  async createAdminFamily(adminId, adminRole, payload) {
    const categoryId = Number(payload.category_id);
    const category = await catalogRepo.findCategoryById(categoryId);
    if (!category) {
      const err = new Error('Valid category_id is required.');
      err.status = 400;
      err.code = 'INVALID_CATEGORY';
      throw err;
    }

    const cleanName = specificationService.normalizeText(payload.name);
    if (!cleanName || cleanName.length < 2) {
      const err = new Error('Family name is required.');
      err.status = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const slug = specificationService.slugify(payload.slug || cleanName);
    const existing = await catalogRepo.findFamilyBySlugOrName(slug, category.id, cleanName);
    if (existing) {
      const err = new Error(`Product family '${cleanName}' already exists.`);
      err.status = 409;
      err.code = 'DUPLICATE_CANONICAL_FAMILY';
      throw err;
    }

    const created = await catalogRepo.createFamily({
      category_id: category.id,
      family_code: payload.family_code || this._generateFamilyCode(slug),
      slug,
      name: cleanName,
      urdu_name: payload.urdu_name || null,
      description: payload.description || null,
      allowed_pack_units: Array.isArray(payload.allowed_pack_units) ? payload.allowed_pack_units : ['kg', 'g'],
      allowed_purchasing_units: Array.isArray(payload.allowed_purchasing_units) ? payload.allowed_purchasing_units : ['bag', 'sack'],
      required_attributes: Array.isArray(payload.required_attributes) ? payload.required_attributes : ['brand', 'variety', 'processing_method', 'quality_grade', 'packaging_type', 'pack_size', 'pack_unit'],
      aliases: Array.isArray(payload.aliases) ? payload.aliases : [],
      approval_status: 'APPROVED',
      is_active: payload.is_active !== undefined ? Boolean(payload.is_active) : true,
      display_order: payload.display_order || 100,
      created_by: adminId
    });

    await this.ensureDefaultProductForFamily(created);

    await catalogRepo.insertModerationLog({
      entity_type: 'FAMILY',
      entity_id: created.id,
      actor_id: adminId,
      actor_role: adminRole,
      from_status: null,
      to_status: 'APPROVED',
      action: 'ADMIN_CREATE_FAMILY',
      metadata: { family_code: created.family_code, name: created.name }
    });

    return catalogRepo.findFamilyById(created.id);
  }

  async createAdminVariant(adminId, adminRole, payload) {
    const familyId = Number(payload.family_id);
    if (!familyId) {
      const err = new Error('family_id is required to create an approved variant.');
      err.status = 400;
      err.code = 'INVALID_FAMILY';
      throw err;
    }

    const family = await catalogRepo.findFamilyById(familyId);
    if (!family) {
      const err = new Error('Product family not found.');
      err.status = 404;
      err.code = 'FAMILY_NOT_FOUND';
      throw err;
    }

    if (payload.category_id && Number(payload.category_id) !== Number(family.category_id)) {
      const err = new Error(`Product family '${family.name}' does not belong to category_id ${payload.category_id}.`);
      err.status = 400;
      err.code = 'CATEGORY_FAMILY_MISMATCH';
      throw err;
    }

    const baseProduct = await this.ensureDefaultProductForFamily(family);

    const cleanBrand = specificationService.normalizeText(payload.brand);
    const cleanVariety = specificationService.normalizeText(payload.variety);
    const cleanCropYear = specificationService.normalizeText(payload.crop_year || 'N/A') || 'N/A';
    const cleanProcessing = specificationService.normalizeText(payload.processing_method || 'Standard') || 'Standard';
    const cleanGrade = specificationService.normalizeText(payload.quality_grade || 'Standard') || 'Standard';
    const cleanPackaging = specificationService.normalizeText(payload.packaging_type);
    const cleanPurchasingUnit = specificationService.normalizeText(payload.purchasing_unit || 'bag').toLowerCase() || 'bag';

    const validation = specificationService.validateSpecificationInput(
      {
        product_id: baseProduct.id,
        brand: cleanBrand,
        variety: cleanVariety,
        crop_year: cleanCropYear,
        processing_method: cleanProcessing,
        quality_grade: cleanGrade,
        packaging_type: cleanPackaging,
        pack_size: payload.pack_size,
        pack_unit: payload.pack_unit,
        purchasing_unit: cleanPurchasingUnit,
        spec_attributes: payload.spec_attributes
      },
      family.category_name,
      family
    );

    if (!validation.valid) {
      const err = new Error(validation.message);
      err.status = 400;
      err.code = validation.code || 'SPECIFICATION_VALIDATION_ERROR';
      throw err;
    }

    const specHash = specificationService.computeSpecHash({
      productId: baseProduct.id,
      brand: cleanBrand,
      variety: cleanVariety,
      cropYear: cleanCropYear,
      processingMethod: cleanProcessing,
      qualityGrade: cleanGrade,
      packagingType: cleanPackaging,
      packSize: validation.normalizedPackSize,
      packUnit: validation.normalizedPackUnit,
      purchasingUnit: cleanPurchasingUnit,
      specAttributes: validation.normalizedAttributes
    });

    const existing = await productSpecRepo.findByHash(specHash);
    if (existing) {
      const err = new Error('An identical physical variant already exists in the canonical catalog.');
      err.status = 409;
      err.code = 'DUPLICATE_APPROVED_VARIANT';
      err.existingSpecification = existing;
      throw err;
    }

    const specCode = specificationService.generateSpecCode(family.category_name, cleanVariety);
    const title = payload.title || `${cleanBrand} ${family.name} - ${cleanVariety} (${cleanGrade}) - ${validation.normalizedPackSize}${validation.normalizedPackUnit} ${cleanPackaging}`;
    const variantTitle = `${cleanBrand} — ${cleanVariety} (${cleanGrade}) — ${validation.normalizedPackSize}${validation.normalizedPackUnit} ${cleanPackaging}`;

    const newId = await productSpecRepo.create({
      product_id: baseProduct.id,
      category_id: family.category_id,
      family_id: family.id,
      variant_title: variantTitle,
      spec_code: specCode,
      title,
      brand: cleanBrand,
      variety: cleanVariety,
      crop_year: cleanCropYear,
      processing_method: cleanProcessing,
      quality_grade: cleanGrade,
      packaging_type: cleanPackaging,
      pack_size: validation.normalizedPackSize,
      pack_unit: validation.normalizedPackUnit,
      purchasing_unit: cleanPurchasingUnit,
      storage_requirements: payload.storage_requirements || null,
      shelf_life_days: payload.shelf_life_days || null,
      spec_attributes: validation.normalizedAttributes,
      spec_hash: specHash,
      approval_status: 'APPROVED',
      created_by: adminId,
      approved_by: adminId,
      approved_at: new Date()
    });

    const createdVariant = await catalogRepo.findVariantById(newId);

    await catalogRepo.insertModerationLog({
      entity_type: 'VARIANT',
      entity_id: newId,
      actor_id: adminId,
      actor_role: adminRole,
      from_status: null,
      to_status: 'APPROVED',
      action: 'ADMIN_CREATE_VARIANT',
      metadata: { spec_code: createdVariant.spec_code, family_id: family.id }
    });

    return createdVariant;
  }
}

module.exports = new CatalogService();
