// =============================================================================
// src/repositories/productSpecificationRepo.js
// MilJor Product Specification Repository (Package E2 Canonical Hierarchy Enabled)
// =============================================================================
const db = require('../config/db');

class ProductSpecificationRepository {
  // Find specification by exact hash for deduplication
  async findByHash(specHash) {
    const [rows] = await db.query(
      `SELECT ps.*,
              p.title AS base_product_title,
              p.category AS product_category,
              c.name AS category_name,
              c.slug AS category_slug,
              c.is_active AS category_is_active,
              c.approval_status AS category_approval_status,
              f.name AS family_name,
              f.slug AS family_slug,
              f.is_active AS family_is_active,
              f.approval_status AS family_approval_status
       FROM product_specifications ps
       JOIN products p ON ps.product_id = p.id
       LEFT JOIN catalog_categories c ON COALESCE(ps.category_id, p.category_id) = c.id
       LEFT JOIN catalog_product_families f ON COALESCE(ps.family_id, p.family_id) = f.id
       WHERE ps.spec_hash = ?`,
      [specHash]
    );
    return rows[0] || null;
  }

  // Find specification by ID with base product & canonical family/category details
  async findById(id) {
    const [rows] = await db.query(
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
              f.is_active AS family_is_active,
              f.approval_status AS family_approval_status
       FROM product_specifications ps
       JOIN products p ON ps.product_id = p.id
       LEFT JOIN catalog_categories c ON COALESCE(ps.category_id, p.category_id) = c.id
       LEFT JOIN catalog_product_families f ON COALESCE(ps.family_id, p.family_id) = f.id
       WHERE ps.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  // Find specification by spec_code
  async findByCode(specCode) {
    const [rows] = await db.query(
      `SELECT ps.*, 
              COALESCE(ps.category_id, p.category_id) AS canonical_category_id,
              COALESCE(ps.family_id, p.family_id) AS canonical_family_id,
              p.title AS base_product_title, 
              p.category AS product_category,
              c.name AS category_name,
              c.slug AS category_slug,
              f.name AS family_name,
              f.slug AS family_slug
       FROM product_specifications ps
       JOIN products p ON ps.product_id = p.id
       LEFT JOIN catalog_categories c ON COALESCE(ps.category_id, p.category_id) = c.id
       LEFT JOIN catalog_product_families f ON COALESCE(ps.family_id, p.family_id) = f.id
       WHERE ps.spec_code = ?`,
      [specCode]
    );
    return rows[0] || null;
  }

  // Create new exact specification (supports canonical category_id, family_id, approval_status & supplier SKU link)
  async create(specData, connection = null) {
    const executor = connection || db;
    const {
      product_id,
      category_id,
      family_id,
      supplier_id,
      supplier_product_id,
      supplier_sku_id,
      variant_title,
      spec_code,
      title,
      brand,
      is_unbranded,
      variety,
      crop_year,
      processing_method,
      quality_grade,
      origin,
      packaging_type,
      pack_size,
      pack_unit,
      purchasing_unit,
      storage_requirements,
      shelf_life_days,
      spec_attributes,
      spec_hash,
      approval_status,
      lifecycle_status,
      created_by,
      approved_by,
      approved_at
    } = specData;

    const brandLabel = brand && !is_unbranded ? brand : 'Unbranded';
    const computedVariantTitle =
      variant_title ||
      `${brandLabel} — ${variety}${quality_grade && quality_grade !== 'N/A' ? ` (${quality_grade})` : ''} — ${Number(pack_size)}${pack_unit} ${packaging_type}`;

    const [result] = await executor.query(
      `INSERT INTO product_specifications (
        product_id, category_id, family_id, supplier_id, supplier_product_id, supplier_sku_id,
        variant_title, spec_code, title, brand, is_unbranded, variety, crop_year,
        processing_method, quality_grade, origin, packaging_type, pack_size,
        pack_unit, purchasing_unit, storage_requirements, shelf_life_days,
        spec_attributes, spec_hash, approval_status, lifecycle_status, created_by, approved_by, approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product_id,
        category_id || null,
        family_id || null,
        supplier_id || null,
        supplier_product_id || null,
        supplier_sku_id || null,
        computedVariantTitle,
        spec_code,
        title,
        brand || null,
        is_unbranded ? 1 : 0,
        variety,
        crop_year || null,
        processing_method || null,
        quality_grade || null,
        origin || null,
        packaging_type,
        pack_size,
        pack_unit,
        purchasing_unit || 'bag',
        storage_requirements || null,
        shelf_life_days || null,
        spec_attributes ? (typeof spec_attributes === 'string' ? spec_attributes : JSON.stringify(spec_attributes)) : null,
        spec_hash,
        approval_status || 'APPROVED',
        lifecycle_status || (supplier_id ? 'PUBLISHED' : 'LEGACY_GLOBAL'),
        created_by || null,
        approved_by || null,
        approved_at || new Date()
      ]
    );

    return result.insertId;
  }

  // Search & filter approved specifications
  async findAll(filters = {}) {
    let sql = `
      SELECT ps.*, 
             COALESCE(ps.category_id, p.category_id) AS canonical_category_id,
             COALESCE(ps.family_id, p.family_id) AS canonical_family_id,
             p.title AS base_product_title, 
             p.category AS product_category,
             c.name AS category_name,
             c.slug AS category_slug,
             f.name AS family_name,
             f.slug AS family_slug
      FROM product_specifications ps
      JOIN products p ON ps.product_id = p.id
      LEFT JOIN catalog_categories c ON COALESCE(ps.category_id, p.category_id) = c.id
      LEFT JOIN catalog_product_families f ON COALESCE(ps.family_id, p.family_id) = f.id
      WHERE ps.is_active = 1
        AND ps.approval_status = 'APPROVED'
    `;
    const params = [];

    if (filters.category) {
      sql += ' AND (p.category = ? OR c.name = ? OR c.slug = ?)';
      params.push(filters.category, filters.category, filters.category);
    }
    if (filters.category_id) {
      sql += ' AND COALESCE(ps.category_id, p.category_id) = ?';
      params.push(Number(filters.category_id));
    }
    if (filters.family_id) {
      sql += ' AND COALESCE(ps.family_id, p.family_id) = ?';
      params.push(Number(filters.family_id));
    }
    if (filters.brand) {
      sql += ' AND ps.brand = ?';
      params.push(filters.brand);
    }
    if (filters.variety) {
      sql += ' AND ps.variety = ?';
      params.push(filters.variety);
    }
    if (filters.quality_grade) {
      sql += ' AND ps.quality_grade = ?';
      params.push(filters.quality_grade);
    }
    if (filters.pack_size) {
      sql += ' AND ps.pack_size = ?';
      params.push(filters.pack_size);
    }
    if (filters.pack_unit) {
      sql += ' AND ps.pack_unit = ?';
      params.push(filters.pack_unit);
    }
    if (filters.product_id) {
      sql += ' AND ps.product_id = ?';
      params.push(filters.product_id);
    }
    if (filters.search) {
      sql += ' AND (ps.title LIKE ? OR ps.brand LIKE ? OR ps.variety LIKE ? OR ps.quality_grade LIKE ? OR p.category LIKE ? OR f.name LIKE ?)';
      const term = `%${filters.search}%`;
      params.push(term, term, term, term, term, term);
    }

    sql += ' ORDER BY ps.id ASC';

    const [rows] = await db.query(sql, params);
    return rows;
  }
}

module.exports = new ProductSpecificationRepository();
