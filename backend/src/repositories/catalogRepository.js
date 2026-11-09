// =============================================================================
// src/repositories/catalogRepository.js
// MilJor Canonical Catalog & Moderation Repository (Package E2)
// =============================================================================
const db = require('../config/db');

class CatalogRepository {
  // ---------------------------------------------------------------------------
  // Helper: Parse JSON columns safely
  // ---------------------------------------------------------------------------
  _parseJson(val, fallback = null) {
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'object') return val;
    try {
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  }

  _hydrateFamily(row) {
    if (!row) return null;
    return {
      ...row,
      is_active: Boolean(row.is_active),
      allowed_pack_units: this._parseJson(row.allowed_pack_units, ['kg']),
      allowed_purchasing_units: this._parseJson(row.allowed_purchasing_units, ['bag']),
      required_attributes: this._parseJson(row.required_attributes, []),
      aliases: this._parseJson(row.aliases, [])
    };
  }

  _hydrateRequest(row) {
    if (!row) return null;
    return {
      ...row,
      pack_size: row.pack_size !== null && row.pack_size !== undefined ? Number(row.pack_size) : null,
      spec_attributes: this._parseJson(row.spec_attributes, null),
      normalized_payload: this._parseJson(row.normalized_payload, {})
    };
  }

  // ---------------------------------------------------------------------------
  // 1. CATEGORIES
  // ---------------------------------------------------------------------------
  async findCategories({ includeInactive = false } = {}) {
    let sql = `
      SELECT c.*,
             (SELECT COUNT(*) FROM catalog_product_families f
              WHERE f.category_id = c.id
                AND f.is_active = 1
                AND f.approval_status = 'APPROVED') AS active_family_count,
             (SELECT COUNT(*) FROM product_specifications ps
              JOIN products p ON ps.product_id = p.id
              WHERE COALESCE(ps.category_id, p.category_id) = c.id
                AND ps.is_active = 1
                AND ps.approval_status = 'APPROVED') AS active_variant_count
      FROM catalog_categories c
    `;
    if (!includeInactive) {
      sql += ` WHERE c.is_active = 1 AND c.approval_status = 'APPROVED'`;
    }
    sql += ` ORDER BY c.display_order ASC, c.id ASC`;
    const [rows] = await db.query(sql);
    return rows.map(r => ({
      ...r,
      is_active: Boolean(r.is_active),
      active_family_count: Number(r.active_family_count || 0),
      active_variant_count: Number(r.active_variant_count || 0)
    }));
  }

  async findCategoryById(id, connection = null) {
    const executor = connection || db;
    const [rows] = await executor.query(
      `SELECT * FROM catalog_categories WHERE id = ?`,
      [id]
    );
    if (!rows[0]) return null;
    return { ...rows[0], is_active: Boolean(rows[0].is_active) };
  }

  async findCategoryBySlugOrName(slug, name, connection = null) {
    const executor = connection || db;
    const [rows] = await executor.query(
      `SELECT * FROM catalog_categories WHERE slug = ? OR LOWER(name) = LOWER(?) LIMIT 1`,
      [slug, name]
    );
    return rows[0] || null;
  }

  async createCategory(data, connection = null) {
    const executor = connection || db;
    const {
      category_code,
      slug,
      name,
      urdu_name,
      description,
      display_order,
      is_active = 1,
      approval_status = 'APPROVED',
      created_by = null
    } = data;

    const [res] = await executor.query(
      `INSERT INTO catalog_categories
       (category_code, slug, name, urdu_name, description, display_order, is_active, approval_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        category_code,
        slug,
        name,
        urdu_name || null,
        description || null,
        Number(display_order || 100),
        is_active ? 1 : 0,
        approval_status,
        created_by
      ]
    );
    return this.findCategoryById(res.insertId, executor);
  }

  async updateCategory(id, updates, connection = null) {
    const executor = connection || db;
    const fields = [];
    const params = [];

    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.slug !== undefined) { fields.push('slug = ?'); params.push(updates.slug); }
    if (updates.urdu_name !== undefined) { fields.push('urdu_name = ?'); params.push(updates.urdu_name); }
    if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
    if (updates.display_order !== undefined) { fields.push('display_order = ?'); params.push(Number(updates.display_order)); }
    if (updates.is_active !== undefined) {
      fields.push('is_active = ?');
      params.push(updates.is_active ? 1 : 0);
      fields.push('approval_status = ?');
      params.push(updates.is_active ? 'APPROVED' : 'INACTIVE');
    }

    if (fields.length === 0) return this.findCategoryById(id, executor);

    params.push(id);
    await executor.query(`UPDATE catalog_categories SET ${fields.join(', ')} WHERE id = ?`, params);
    return this.findCategoryById(id, executor);
  }

  // ---------------------------------------------------------------------------
  // 2. PRODUCT FAMILIES
  // ---------------------------------------------------------------------------
  async findFamilies({ categoryId = null, includeInactive = false, search = null } = {}) {
    let sql = `
      SELECT f.*,
             c.name AS category_name,
             c.slug AS category_slug,
             c.category_code,
             c.is_active AS category_is_active,
             (SELECT COUNT(*) FROM product_specifications ps
              JOIN products p ON ps.product_id = p.id
              WHERE COALESCE(ps.family_id, p.family_id) = f.id
                AND ps.is_active = 1
                AND ps.approval_status = 'APPROVED') AS approved_variant_count
      FROM catalog_product_families f
      JOIN catalog_categories c ON f.category_id = c.id
      WHERE 1 = 1
    `;
    const params = [];

    if (!includeInactive) {
      sql += ` AND f.is_active = 1 AND f.approval_status = 'APPROVED' AND c.is_active = 1 AND c.approval_status = 'APPROVED'`;
    }
    if (categoryId) {
      sql += ` AND f.category_id = ?`;
      params.push(Number(categoryId));
    }
    if (search) {
      sql += ` AND (f.name LIKE ? OR f.description LIKE ? OR c.name LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    sql += ` ORDER BY c.display_order ASC, f.display_order ASC, f.id ASC`;
    const [rows] = await db.query(sql, params);
    return rows.map(r => ({
      ...this._hydrateFamily(r),
      approved_variant_count: Number(r.approved_variant_count || 0)
    }));
  }

  async findFamilyById(id, connection = null) {
    const executor = connection || db;
    const [rows] = await executor.query(
      `SELECT f.*,
              c.name AS category_name,
              c.slug AS category_slug,
              c.category_code,
              c.is_active AS category_is_active,
              c.approval_status AS category_approval_status
       FROM catalog_product_families f
       JOIN catalog_categories c ON f.category_id = c.id
       WHERE f.id = ?`,
      [id]
    );
    return this._hydrateFamily(rows[0]);
  }

  async findFamilyBySlugOrName(slug, categoryId, name, connection = null) {
    const executor = connection || db;
    const [rows] = await executor.query(
      `SELECT * FROM catalog_product_families
       WHERE slug = ? OR (category_id = ? AND LOWER(name) = LOWER(?))
       LIMIT 1`,
      [slug, Number(categoryId), name]
    );
    return this._hydrateFamily(rows[0]);
  }

  async createFamily(data, connection = null) {
    const executor = connection || db;
    const {
      category_id,
      family_code,
      slug,
      name,
      urdu_name = null,
      description = null,
      default_product_id = null,
      allowed_pack_units = ['kg', 'g'],
      allowed_purchasing_units = ['bag', 'sack'],
      required_attributes = ['brand', 'variety', 'processing_method', 'quality_grade', 'packaging_type', 'pack_size', 'pack_unit'],
      aliases = [],
      approval_status = 'APPROVED',
      is_active = 1,
      display_order = 100,
      created_by = null
    } = data;

    const [res] = await executor.query(
      `INSERT INTO catalog_product_families
       (category_id, family_code, slug, name, urdu_name, description, default_product_id,
        allowed_pack_units, allowed_purchasing_units, required_attributes, aliases,
        approval_status, is_active, display_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(category_id),
        family_code,
        slug,
        name,
        urdu_name,
        description,
        default_product_id,
        JSON.stringify(allowed_pack_units),
        JSON.stringify(allowed_purchasing_units),
        JSON.stringify(required_attributes),
        JSON.stringify(aliases),
        approval_status,
        is_active ? 1 : 0,
        Number(display_order || 100),
        created_by
      ]
    );

    return this.findFamilyById(res.insertId, executor);
  }

  async updateFamily(id, updates, connection = null) {
    const executor = connection || db;
    const fields = [];
    const params = [];

    if (updates.category_id !== undefined) { fields.push('category_id = ?'); params.push(Number(updates.category_id)); }
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.slug !== undefined) { fields.push('slug = ?'); params.push(updates.slug); }
    if (updates.urdu_name !== undefined) { fields.push('urdu_name = ?'); params.push(updates.urdu_name); }
    if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
    if (updates.default_product_id !== undefined) { fields.push('default_product_id = ?'); params.push(updates.default_product_id); }
    if (updates.allowed_pack_units !== undefined) { fields.push('allowed_pack_units = ?'); params.push(JSON.stringify(updates.allowed_pack_units)); }
    if (updates.allowed_purchasing_units !== undefined) { fields.push('allowed_purchasing_units = ?'); params.push(JSON.stringify(updates.allowed_purchasing_units)); }
    if (updates.required_attributes !== undefined) { fields.push('required_attributes = ?'); params.push(JSON.stringify(updates.required_attributes)); }
    if (updates.aliases !== undefined) { fields.push('aliases = ?'); params.push(JSON.stringify(updates.aliases)); }
    if (updates.display_order !== undefined) { fields.push('display_order = ?'); params.push(Number(updates.display_order)); }
    if (updates.is_active !== undefined) {
      fields.push('is_active = ?');
      params.push(updates.is_active ? 1 : 0);
      fields.push('approval_status = ?');
      params.push(updates.is_active ? 'APPROVED' : 'ARCHIVED');
    }

    if (fields.length === 0) return this.findFamilyById(id, executor);

    params.push(id);
    await executor.query(`UPDATE catalog_product_families SET ${fields.join(', ')} WHERE id = ?`, params);
    return this.findFamilyById(id, executor);
  }

  // ---------------------------------------------------------------------------
  // 3. APPROVED PHYSICAL VARIANTS (product_specifications)
  // ---------------------------------------------------------------------------
  async findVariants({ familyId = null, categoryId = null, includeInactive = false, search = null } = {}) {
    let sql = `
      SELECT ps.*,
             COALESCE(ps.category_id, p.category_id) AS canonical_category_id,
             COALESCE(ps.family_id, p.family_id) AS canonical_family_id,
             p.title AS base_product_title,
             p.category AS product_category,
             c.name AS category_name,
             c.slug AS category_slug,
             f.name AS family_name,
             f.slug AS family_slug,
             f.family_code,
             (SELECT COUNT(*) FROM supplier_listings sl
              WHERE sl.product_spec_id = ps.id AND sl.status = 'ACTIVE') AS active_offer_count
      FROM product_specifications ps
      JOIN products p ON ps.product_id = p.id
      LEFT JOIN catalog_categories c ON COALESCE(ps.category_id, p.category_id) = c.id
      LEFT JOIN catalog_product_families f ON COALESCE(ps.family_id, p.family_id) = f.id
      WHERE 1 = 1
    `;
    const params = [];

    if (!includeInactive) {
      sql += `
        AND ps.is_active = 1
        AND ps.approval_status = 'APPROVED'
        AND c.is_active = 1
        AND c.approval_status = 'APPROVED'
        AND f.is_active = 1
        AND f.approval_status = 'APPROVED'
      `;
    }
    if (familyId) {
      sql += ` AND COALESCE(ps.family_id, p.family_id) = ?`;
      params.push(Number(familyId));
    }
    if (categoryId) {
      sql += ` AND COALESCE(ps.category_id, p.category_id) = ?`;
      params.push(Number(categoryId));
    }
    if (search) {
      sql += ` AND (ps.title LIKE ? OR ps.variant_title LIKE ? OR ps.brand LIKE ? OR ps.variety LIKE ? OR f.name LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term, term);
    }

    sql += ` ORDER BY ps.id ASC`;
    const [rows] = await db.query(sql, params);
    return rows.map(r => ({
      ...r,
      category_id: r.canonical_category_id,
      family_id: r.canonical_family_id,
      pack_size: Number(r.pack_size),
      is_active: Boolean(r.is_active),
      spec_attributes: this._parseJson(r.spec_attributes, null),
      active_offer_count: Number(r.active_offer_count || 0)
    }));
  }

  async findVariantById(id, connection = null) {
    const executor = connection || db;
    const [rows] = await executor.query(
      `SELECT ps.*,
              COALESCE(ps.category_id, p.category_id) AS canonical_category_id,
              COALESCE(ps.family_id, p.family_id) AS canonical_family_id,
              p.title AS base_product_title,
              p.category AS product_category,
              c.name AS category_name,
              c.slug AS category_slug,
              c.is_active AS category_is_active,
              c.approval_status AS category_approval_status,
              f.name AS family_name,
              f.slug AS family_slug,
              f.family_code,
              f.is_active AS family_is_active,
              f.approval_status AS family_approval_status
       FROM product_specifications ps
       JOIN products p ON ps.product_id = p.id
       LEFT JOIN catalog_categories c ON COALESCE(ps.category_id, p.category_id) = c.id
       LEFT JOIN catalog_product_families f ON COALESCE(ps.family_id, p.family_id) = f.id
       WHERE ps.id = ?`,
      [id]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      ...r,
      category_id: r.canonical_category_id,
      family_id: r.canonical_family_id,
      pack_size: Number(r.pack_size),
      is_active: Boolean(r.is_active),
      spec_attributes: this._parseJson(r.spec_attributes, null)
    };
  }

  // ---------------------------------------------------------------------------
  // 4. CATALOG REQUESTS & MODERATION LOGS
  // ---------------------------------------------------------------------------
  async findActiveDuplicateRequest(dedupHash, excludeRequestId = null, connection = null) {
    const executor = connection || db;
    let sql = `
      SELECT * FROM catalog_requests
      WHERE dedup_hash = ?
        AND status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED')
    `;
    const params = [dedupHash];
    if (excludeRequestId) {
      sql += ` AND id != ?`;
      params.push(Number(excludeRequestId));
    }
    sql += ` LIMIT 1`;
    const [rows] = await executor.query(sql, params);
    return this._hydrateRequest(rows[0]);
  }

  async createCatalogRequest(data, connection = null) {
    const executor = connection || db;
    const {
      request_code,
      supplier_id,
      request_type,
      category_id,
      family_id = null,
      proposed_family_name = null,
      proposed_family_slug = null,
      proposed_variant_title = null,
      brand = null,
      variety = null,
      crop_year = 'N/A',
      processing_method = 'N/A',
      quality_grade = 'Standard',
      packaging_type = null,
      pack_size = null,
      pack_unit = null,
      purchasing_unit = null,
      spec_attributes = null,
      normalized_payload = {},
      supporting_notes = null,
      dedup_hash,
      status = 'SUBMITTED',
      submitted_at = new Date()
    } = data;

    const [res] = await executor.query(
      `INSERT INTO catalog_requests (
        request_code, supplier_id, request_type, category_id, family_id,
        proposed_family_name, proposed_family_slug, proposed_variant_title,
        brand, variety, crop_year, processing_method, quality_grade,
        packaging_type, pack_size, pack_unit, purchasing_unit,
        spec_attributes, normalized_payload, supporting_notes,
        dedup_hash, status, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request_code,
        Number(supplier_id),
        request_type,
        Number(category_id),
        family_id ? Number(family_id) : null,
        proposed_family_name,
        proposed_family_slug,
        proposed_variant_title,
        brand,
        variety,
        crop_year,
        processing_method,
        quality_grade,
        packaging_type,
        pack_size,
        pack_unit,
        purchasing_unit,
        spec_attributes ? JSON.stringify(spec_attributes) : null,
        JSON.stringify(normalized_payload),
        supporting_notes,
        dedup_hash,
        status,
        status === 'DRAFT' ? null : submitted_at
      ]
    );

    return this.findCatalogRequestById(res.insertId, executor);
  }

  async updateCatalogRequest(id, updates, connection = null) {
    const executor = connection || db;
    const fields = [];
    const params = [];

    const allowedDirect = [
      'category_id',
      'family_id',
      'proposed_family_name',
      'proposed_family_slug',
      'proposed_variant_title',
      'brand',
      'variety',
      'crop_year',
      'processing_method',
      'quality_grade',
      'packaging_type',
      'pack_size',
      'pack_unit',
      'purchasing_unit',
      'supporting_notes',
      'dedup_hash',
      'status',
      'rejection_reason',
      'review_notes',
      'reviewed_by',
      'reviewed_at',
      'approved_family_id',
      'approved_spec_id',
      'submitted_at'
    ];

    for (const key of allowedDirect) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(updates[key]);
      }
    }

    if (updates.spec_attributes !== undefined) {
      fields.push('spec_attributes = ?');
      params.push(updates.spec_attributes ? JSON.stringify(updates.spec_attributes) : null);
    }

    if (updates.normalized_payload !== undefined) {
      fields.push('normalized_payload = ?');
      params.push(JSON.stringify(updates.normalized_payload));
    }

    if (fields.length === 0) return this.findCatalogRequestById(id, executor);

    params.push(id);
    await executor.query(`UPDATE catalog_requests SET ${fields.join(', ')} WHERE id = ?`, params);
    return this.findCatalogRequestById(id, executor);
  }

  async findCatalogRequestById(id, connection = null, forUpdate = false) {
    const executor = connection || db;
    const lockSql = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await executor.query(
      `SELECT cr.*,
              c.name AS category_name,
              c.slug AS category_slug,
              f.name AS family_name,
              f.slug AS family_slug,
              u.full_name AS supplier_name,
              u.email AS supplier_email,
              COALESCE(u.business_name, u.full_name) AS supplier_business_name,
              sp.verification_status AS supplier_verification_status,
              rev.full_name AS reviewed_by_name
       FROM catalog_requests cr
       JOIN catalog_categories c ON cr.category_id = c.id
       LEFT JOIN catalog_product_families f ON cr.family_id = f.id
       JOIN users u ON cr.supplier_id = u.id
       LEFT JOIN supplier_profiles sp ON sp.supplier_id = cr.supplier_id
       LEFT JOIN users rev ON cr.reviewed_by = rev.id
       WHERE cr.id = ?${lockSql}`,
      [id]
    );
    return this._hydrateRequest(rows[0]);
  }

  async findSupplierCatalogRequests(supplierId, { status = null, requestType = null } = {}) {
    let sql = `
      SELECT cr.*,
             c.name AS category_name,
             c.slug AS category_slug,
             f.name AS family_name,
             f.slug AS family_slug
      FROM catalog_requests cr
      JOIN catalog_categories c ON cr.category_id = c.id
      LEFT JOIN catalog_product_families f ON cr.family_id = f.id
      WHERE cr.supplier_id = ?
    `;
    const params = [Number(supplierId)];
    if (status) {
      sql += ` AND cr.status = ?`;
      params.push(status);
    }
    if (requestType) {
      sql += ` AND cr.request_type = ?`;
      params.push(requestType);
    }
    sql += ` ORDER BY cr.id DESC`;
    const [rows] = await db.query(sql, params);
    return rows.map(r => this._hydrateRequest(r));
  }

  async findAllCatalogRequests({ status = null, requestType = null, categoryId = null, supplierId = null } = {}) {
    let sql = `
      SELECT cr.*,
             c.name AS category_name,
             c.slug AS category_slug,
             f.name AS family_name,
             f.slug AS family_slug,
             u.full_name AS supplier_name,
             u.email AS supplier_email,
             COALESCE(u.business_name, u.full_name) AS supplier_business_name,
             u.business_name AS supplier_trading_name,
             sp.verification_status AS supplier_verification_status,
             rev.full_name AS reviewed_by_name
      FROM catalog_requests cr
      JOIN catalog_categories c ON cr.category_id = c.id
      LEFT JOIN catalog_product_families f ON cr.family_id = f.id
      JOIN users u ON cr.supplier_id = u.id
      LEFT JOIN supplier_profiles sp ON sp.supplier_id = cr.supplier_id
      LEFT JOIN users rev ON cr.reviewed_by = rev.id
      WHERE 1 = 1
    `;
    const params = [];
    if (status) {
      sql += ` AND cr.status = ?`;
      params.push(status);
    }
    if (requestType) {
      sql += ` AND cr.request_type = ?`;
      params.push(requestType);
    }
    if (categoryId) {
      sql += ` AND cr.category_id = ?`;
      params.push(Number(categoryId));
    }
    if (supplierId) {
      sql += ` AND cr.supplier_id = ?`;
      params.push(Number(supplierId));
    }
    sql += ` ORDER BY FIELD(cr.status, 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DRAFT'), cr.id DESC`;
    const [rows] = await db.query(sql, params);
    return rows.map(r => this._hydrateRequest(r));
  }

  async insertModerationLog(logData, connection = null) {
    const executor = connection || db;
    const {
      request_id = null,
      entity_type = 'CATALOG_REQUEST',
      entity_id,
      actor_id,
      actor_role,
      from_status = null,
      to_status,
      action,
      reason = null,
      metadata = null
    } = logData;

    await executor.query(
      `INSERT INTO catalog_moderation_logs
       (request_id, entity_type, entity_id, actor_id, actor_role, from_status, to_status, action, reason, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request_id,
        entity_type,
        Number(entity_id),
        Number(actor_id),
        actor_role,
        from_status,
        to_status,
        action,
        reason,
        metadata ? JSON.stringify(metadata) : null
      ]
    );
  }

  async findModerationLogsByRequestId(requestId, connection = null) {
    const executor = connection || db;
    const [rows] = await executor.query(
      `SELECT l.*, u.full_name AS actor_name
       FROM catalog_moderation_logs l
       LEFT JOIN users u ON l.actor_id = u.id
       WHERE l.request_id = ?
       ORDER BY l.id ASC`,
      [requestId]
    );
    return rows.map(r => ({
      ...r,
      metadata: this._parseJson(r.metadata, null)
    }));
  }
}

module.exports = new CatalogRepository();
