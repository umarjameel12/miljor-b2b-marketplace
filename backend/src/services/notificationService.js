'use strict';
// =============================================================================
// backend/src/services/notificationService.js
// MilJor Platform In-App Notification Service
// Provides recipient-isolated, persistent, deduplicated in-app notifications
// across all core platform lifecycle events.
// =============================================================================
const db = require('../config/db');

class NotificationService {
  /**
   * Dispatches a new persistent notification to a specific user.
   * Enforces deduplication via unique (user_id, event_key) constraint.
   *
   * @param {Object} params
   * @param {number} params.userId - Recipient user ID
   * @param {'BUYER'|'SUPPLIER'|'ADMIN'|'SUPER_ADMIN'} params.role - Recipient role
   * @param {string} params.eventType - Standard platform event type
   * @param {string} params.eventKey - Unique event correlation key (e.g., 'PAY_154', 'DISP_22')
   * @param {string} params.title - Short notification title
   * @param {string} params.message - Human-readable notification message
   * @param {Object} [params.payload] - Optional metadata payload
   * @returns {Promise<{ created: boolean, notificationId?: number, duplicate?: boolean }>}
   */
  async createNotification({ userId, role, eventType, eventKey, title, message, payload = null }) {
    if (!userId || !role || !eventType || !eventKey || !title || !message) {
      throw new Error('Missing required notification fields');
    }

    const payloadJson = payload ? JSON.stringify(payload) : null;

    try {
      const [result] = await db.query(
        `INSERT INTO platform_notifications 
         (user_id, role, event_type, event_key, title, message, payload, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
        [userId, role, eventType, eventKey, title, message, payloadJson]
      );

      return {
        created: true,
        notificationId: result.insertId,
        duplicate: false
      };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        // Safe deduplication: duplicate eventKey ignored
        return {
          created: false,
          duplicate: true
        };
      }
      throw err;
    }
  }

  // PR #53 canonical supplier/buyer notification preferences.
  // Server-only user scope; no caller-supplied user ID.
  async getPreferences(userId) {
    const [rows] = await db.query(
      'SELECT locale,optional_email,optional_sms FROM notification_preferences WHERE user_id=?',
      [userId]
    );
    return rows[0] || {locale:'en',optional_email:1,optional_sms:0};
  }

  async setPreferences(userId,input) {
    if(!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(field=>!['locale','optional_email','optional_sms'].includes(field)) ||
      !['en','ur'].includes(input.locale) ||
      typeof input.optional_email !== 'boolean' || typeof input.optional_sms !== 'boolean') {
      const error = new Error('Invalid notification preferences');
      error.statusCode=400;error.code='INVALID_NOTIFICATION_PREFERENCES';throw error;
    }
    await db.query(
      `INSERT INTO notification_preferences(user_id,locale,optional_email,optional_sms) VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE locale=VALUES(locale),optional_email=VALUES(optional_email),optional_sms=VALUES(optional_sms)`,
      [userId,input.locale,Number(input.optional_email),Number(input.optional_sms)]
    );
    return this.getPreferences(userId);
  }

  /**
   * Retrieves paginated notifications strictly isolated to the specified user.
   */
  async listUserNotifications(userId, { limit = 50, offset = 0, unreadOnly = false } = {}) {
    let sql = 'SELECT id, role, event_type, event_key, title, message, payload, is_read, created_at, read_at FROM platform_notifications WHERE user_id = ?';
    const params = [userId];

    if (unreadOnly) {
      sql += ' AND is_read = 0';
    }

    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const [rows] = await db.query(sql, params);
    return rows.map(r => ({
      ...r,
      payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload
    }));
  }

  /**
   * Gets the unread notification count for a user.
   */
  async getUnreadCount(userId) {
    const [[row]] = await db.query(
      'SELECT COUNT(*) as unread_count FROM platform_notifications WHERE user_id = ? AND is_read = 0',
      [userId]
    );
    return Number(row.unread_count || 0);
  }

  /**
   * Marks a specific notification as read, ensuring strict recipient ownership.
   */
  async markAsRead(userId, notificationId) {
    const [result] = await db.query(
      'UPDATE platform_notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND user_id = ? AND is_read = 0',
      [notificationId, userId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Marks all unread notifications as read for a user.
   */
  async markAllAsRead(userId) {
    const [result] = await db.query(
      'UPDATE platform_notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND is_read = 0',
      [userId]
    );
    return result.affectedRows;
  }
}

module.exports = new NotificationService();
