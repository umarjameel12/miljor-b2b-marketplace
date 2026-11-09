const db = require('../config/db');

class ProductRepository {
  // Create New Product Base Record (Admin-governed in Package E2)
  async create(productData, connection = null) {
    const executor = connection || db;
    const {
      title,
      category,
      category_id,
      family_id,
      canonical_slug,
      brand,
      variety,
      processing_type,
      grade,
      pack_size,
      unit,
      approval_status,
      mapping_status
    } = productData;

    const [result] = await executor.query(
      `INSERT INTO products 
      (title, category, category_id, family_id, canonical_slug, brand, variety, processing_type, grade, pack_size, unit, approval_status, mapping_status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        category,
        category_id || null,
        family_id || null,
        canonical_slug || null,
        brand,
        variety,
        processing_type,
        grade,
        pack_size,
        unit || 'kg',
        approval_status || 'APPROVED',
        mapping_status || 'MAPPED_CANONICAL'
      ]
    );

    return result.insertId;
  }

  // Get All Active Approved Products with Filtering & Search
  async findAll(filters = {}) {
    let sql = `
      SELECT p.*,
             c.name AS canonical_category_name,
             c.slug AS canonical_category_slug,
             f.name AS canonical_family_name,
             f.slug AS canonical_family_slug
      FROM products p
      LEFT JOIN catalog_categories c ON p.category_id = c.id
      LEFT JOIN catalog_product_families f ON p.family_id = f.id
      WHERE p.is_active = TRUE
        AND p.approval_status = 'APPROVED'
    `;
    const params = [];

    if (filters.category) {
      sql += ' AND (p.category = ? OR c.name = ? OR c.slug = ?)';
      params.push(filters.category, filters.category, filters.category);
    }

    if (filters.category_id) {
      sql += ' AND p.category_id = ?';
      params.push(Number(filters.category_id));
    }

    if (filters.family_id) {
      sql += ' AND p.family_id = ?';
      params.push(Number(filters.family_id));
    }

    if (filters.brand) {
      sql += ' AND p.brand = ?';
      params.push(filters.brand);
    }

    if (filters.search) {
      sql += ' AND (p.title LIKE ? OR p.variety LIKE ? OR p.brand LIKE ? OR f.name LIKE ?)';
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    sql += ' ORDER BY p.id DESC';

    const [rows] = await db.query(sql, params);
    return rows;
  }

  // Find Product By ID
  async findById(id, connection = null) {
    const executor = connection || db;
    const [rows] = await executor.query(
      `SELECT p.*,
              c.name AS canonical_category_name,
              c.slug AS canonical_category_slug,
              f.name AS canonical_family_name,
              f.slug AS canonical_family_slug
       FROM products p
       LEFT JOIN catalog_categories c ON p.category_id = c.id
       LEFT JOIN catalog_product_families f ON p.family_id = f.id
       WHERE p.id = ?`,
      [id]
    );
    return rows[0];
  }
}

module.exports = new ProductRepository();
