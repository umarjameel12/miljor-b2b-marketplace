// =============================================================================
// src/repositories/buyerAddressRepository.js
// MilJor Special Phase G2: Buyer Delivery Addresses Repository
// =============================================================================
const defaultDb = require('../config/db');

class BuyerAddressRepository {
  /**
   * Fetch all saved delivery addresses for a buyer
   */
  async getAddressesByUserId(userId, connection) {
    const db = connection || defaultDb;
    const [rows] = await db.query(
      `SELECT 
        a.id,
        a.user_id,
        a.city,
        a.cluster_id,
        a.cluster_version,
        a.society_area,
        a.full_address,
        CAST(a.pin_latitude AS DOUBLE) AS pin_latitude,
        CAST(a.pin_longitude AS DOUBLE) AS pin_longitude,
        a.geographic_match_status,
        a.user_confirmation_status,
        a.business_verification_status,
        a.manual_review_required,
        a.is_default,
        a.revision,
        a.created_at,
        a.updated_at,
        c.cluster_code,
        c.name AS cluster_name,
        c.region_code,
        c.hub_name,
        c.covered_areas_summary
       FROM buyer_delivery_addresses a
       JOIN geographic_clusters c ON a.cluster_id = c.id
       WHERE a.user_id = ?
       ORDER BY a.is_default DESC, a.id DESC`,
      [userId]
    );
    return rows;
  }

  /**
   * Fetch a single address by ID and user ownership
   */
  async getAddressById(addressId, userId, connection) {
    const db = connection || defaultDb;
    const [rows] = await db.query(
      `SELECT 
        a.id,
        a.user_id,
        a.city,
        a.cluster_id,
        a.cluster_version,
        a.society_area,
        a.full_address,
        CAST(a.pin_latitude AS DOUBLE) AS pin_latitude,
        CAST(a.pin_longitude AS DOUBLE) AS pin_longitude,
        a.geographic_match_status,
        a.user_confirmation_status,
        a.business_verification_status,
        a.manual_review_required,
        a.is_default,
        a.revision,
        a.created_at,
        c.cluster_code,
        c.name AS cluster_name,
        c.region_code
       FROM buyer_delivery_addresses a
       JOIN geographic_clusters c ON a.cluster_id = c.id
       WHERE a.id = ? AND a.user_id = ?`,
      [addressId, userId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Insert new buyer delivery address
   * Serializes on user row to guarantee at most one default address under concurrency.
   */
  async createAddress(addressData, connection) {
    const isExternalConn = Boolean(connection);
    const conn = connection || await defaultDb.getConnection();
    if (!isExternalConn) await conn.beginTransaction();

    try {
      const {
        user_id,
        city = 'Lahore',
        cluster_id,
        cluster_version = 1,
        society_area,
        full_address,
        pin_latitude = null,
        pin_longitude = null,
        geographic_match_status = 'PROVISIONAL',
        user_confirmation_status = 'CONFIRMED',
        business_verification_status = 'NOT_REQUIRED',
        manual_review_required = false,
        is_default = false
      } = addressData;

      // Lock parent user row to serialize address mutations and default assignment
      await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [user_id]);

      // Check existing addresses count for this user
      const [existingRows] = await conn.query(
        'SELECT id FROM buyer_delivery_addresses WHERE user_id = ?',
        [user_id]
      );

      // If first address for user, automatically promote to default
      const effectiveIsDefault = existingRows.length === 0 ? true : Boolean(is_default);

      // If setting as default, clear existing default for this user
      if (effectiveIsDefault) {
        await conn.query(
          `UPDATE buyer_delivery_addresses SET is_default = FALSE WHERE user_id = ?`,
          [user_id]
        );
      }

      const [result] = await conn.query(
        `INSERT INTO buyer_delivery_addresses (
          user_id, city, cluster_id, cluster_version, society_area,
          full_address, pin_latitude, pin_longitude, geographic_match_status,
          user_confirmation_status, business_verification_status,
          manual_review_required, is_default, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          user_id,
          city,
          cluster_id,
          cluster_version,
          society_area,
          full_address,
          pin_latitude,
          pin_longitude,
          geographic_match_status,
          user_confirmation_status,
          business_verification_status,
          manual_review_required,
          effectiveIsDefault
        ]
      );

      if (!isExternalConn) await conn.commit();
      return result.insertId;
    } catch (err) {
      if (!isExternalConn) await conn.rollback();
      throw err;
    } finally {
      if (!isExternalConn) conn.release();
    }
  }

  /**
   * Update address fields
   * Serializes on user row to guarantee at most one default address under concurrency.
   */
  async updateAddress(addressId, userId, updateData, connection) {
    const isExternalConn = Boolean(connection);
    const conn = connection || await defaultDb.getConnection();
    if (!isExternalConn) await conn.beginTransaction();

    try {
      // Lock parent user row to serialize address mutations
      await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);

      const {
        cluster_id,
        cluster_version,
        society_area,
        full_address,
        pin_latitude,
        pin_longitude,
        geographic_match_status,
        user_confirmation_status,
        manual_review_required,
        is_default
      } = updateData;

      if (is_default) {
        await conn.query(
          `UPDATE buyer_delivery_addresses SET is_default = FALSE WHERE user_id = ?`,
          [userId]
        );
      }

      const fields = [];
      const values = [];

      if (cluster_id !== undefined) { fields.push('cluster_id = ?'); values.push(cluster_id); }
      if (cluster_version !== undefined) { fields.push('cluster_version = ?'); values.push(cluster_version); }
      if (society_area !== undefined) { fields.push('society_area = ?'); values.push(society_area); }
      if (full_address !== undefined) { fields.push('full_address = ?'); values.push(full_address); }
      if (pin_latitude !== undefined) { fields.push('pin_latitude = ?'); values.push(pin_latitude); }
      if (pin_longitude !== undefined) { fields.push('pin_longitude = ?'); values.push(pin_longitude); }
      if (geographic_match_status !== undefined) { fields.push('geographic_match_status = ?'); values.push(geographic_match_status); }
      if (user_confirmation_status !== undefined) { fields.push('user_confirmation_status = ?'); values.push(user_confirmation_status); }
      if (manual_review_required !== undefined) { fields.push('manual_review_required = ?'); values.push(manual_review_required); }
      if (is_default !== undefined) { fields.push('is_default = ?'); values.push(Boolean(is_default)); }

      if (fields.length === 0) {
        if (!isExternalConn) await conn.commit();
        return false;
      }

      fields.push('revision = revision + 1');
      fields.push('updated_at = NOW()');
      values.push(addressId, userId);

      const [result] = await conn.query(
        `UPDATE buyer_delivery_addresses SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
        values
      );

      // If user set is_default to false, ensure at least one address remains default if other addresses exist
      if (is_default === false) {
        const [remainingDefaults] = await conn.query(
          'SELECT id FROM buyer_delivery_addresses WHERE user_id = ? AND is_default = TRUE',
          [userId]
        );
        if (remainingDefaults.length === 0) {
          // Re-default the most recent address
          await conn.query(
            'UPDATE buyer_delivery_addresses SET is_default = TRUE WHERE user_id = ? ORDER BY id DESC LIMIT 1',
            [userId]
          );
        }
      }

      if (!isExternalConn) await conn.commit();
      return result.affectedRows > 0;
    } catch (err) {
      if (!isExternalConn) await conn.rollback();
      throw err;
    } finally {
      if (!isExternalConn) conn.release();
    }
  }

  /**
   * Delete an address with automatic fallback to most recent remaining address
   * Serializes on user row to guarantee at most one default address under concurrency.
   */
  async deleteAddress(addressId, userId, connection) {
    const isExternalConn = Boolean(connection);
    const conn = connection || await defaultDb.getConnection();
    if (!isExternalConn) await conn.beginTransaction();

    try {
      // Lock parent user row
      await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);

      // Check if the address being deleted is default
      const [targetRows] = await conn.query(
        'SELECT id, is_default FROM buyer_delivery_addresses WHERE id = ? AND user_id = ?',
        [addressId, userId]
      );

      const wasDefault = targetRows.length > 0 && Boolean(targetRows[0].is_default);

      const [result] = await conn.query(
        `DELETE FROM buyer_delivery_addresses WHERE id = ? AND user_id = ?`,
        [addressId, userId]
      );

      // If deleted address was default, promote the latest remaining address to default
      if (wasDefault) {
        const [remaining] = await conn.query(
          'SELECT id FROM buyer_delivery_addresses WHERE user_id = ? ORDER BY id DESC LIMIT 1',
          [userId]
        );
        if (remaining.length > 0) {
          await conn.query(
            'UPDATE buyer_delivery_addresses SET is_default = TRUE WHERE id = ?',
            [remaining[0].id]
          );
        }
      }

      if (!isExternalConn) await conn.commit();
      return result.affectedRows > 0;
    } catch (err) {
      if (!isExternalConn) await conn.rollback();
      throw err;
    } finally {
      if (!isExternalConn) conn.release();
    }
  }
}

module.exports = new BuyerAddressRepository();
