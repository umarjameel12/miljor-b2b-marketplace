// =============================================================================
// src/services/messagingService.js
// MilJor Package E6: Contextual In-App Messaging & Anti-Bypass System
// Detects phone numbers, email addresses, and premature contact leaks
// =============================================================================

const db = require('../config/db');

// Pattern to catch Pakistani phone numbers (+92, 03xx), emails, and contact keywords
const PHONE_PATTERN = /(\+?92\s?3\d{2}|\b03\d{2})[-.\s]?\d{7}\b/i;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i;
const KEYWORD_PATTERN = /\b(whatsapp|call\s*me|phone|contact\s*me|raabta|number|call\s*karo)\b/i;

class MessagingService {

  checkAntiBypass(text) {
    const hasPhone = PHONE_PATTERN.test(text);
    const hasEmail = EMAIL_PATTERN.test(text);
    const hasKeyword = KEYWORD_PATTERN.test(text);
    return hasPhone || hasEmail || hasKeyword;
  }

  async getOrCreateConversation({ buyerId, supplierId, orderId = null, poolId = null }) {
    let query = 'SELECT * FROM in_app_conversations WHERE buyer_id = ? AND supplier_id = ?';
    const params = [buyerId, supplierId];

    if (orderId) {
      query += ' AND order_id = ?';
      params.push(orderId);
    } else if (poolId) {
      query += ' AND pool_id = ?';
      params.push(poolId);
    }

    const [rows] = await db.query(query, params);
    if (rows.length > 0) return rows[0];

    const code = `CONV-${Date.now().toString().slice(-6)}`;
    const [res] = await db.query(
      `INSERT INTO in_app_conversations (conversation_code, order_id, pool_id, buyer_id, supplier_id)
       VALUES (?, ?, ?, ?, ?)`,
      [code, orderId, poolId, buyerId, supplierId]
    );

    const [created] = await db.query('SELECT * FROM in_app_conversations WHERE id = ?', [res.insertId]);
    return created[0];
  }

  async sendMessage({ conversationId, senderId, text }) {
    if (!text || text.trim().length === 0) {
      const err = new Error('Message text cannot be empty');
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    const [convRows] = await db.query('SELECT * FROM in_app_conversations WHERE id = ?', [conversationId]);
    if (!convRows[0]) {
      const err = new Error('Conversation not found');
      err.code = 'NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const conv = convRows[0];
    if (conv.buyer_id !== senderId && conv.supplier_id !== senderId) {
      const err = new Error('You are not a participant in this conversation');
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }

    const hasWarning = this.checkAntiBypass(text);

    const [res] = await db.query(
      `INSERT INTO in_app_messages (conversation_id, sender_id, message_text, has_contact_warning)
       VALUES (?, ?, ?, ?)`,
      [conversationId, senderId, text.trim(), hasWarning ? 1 : 0]
    );

    await db.query('UPDATE in_app_conversations SET last_message_at = NOW() WHERE id = ?', [conversationId]);

    const [created] = await db.query('SELECT * FROM in_app_messages WHERE id = ?', [res.insertId]);
    return {
      message: created[0],
      anti_bypass_warning: hasWarning
        ? 'Reminder: For your safety and escrow protection, keep all communication, negotiations, and payments within MilJor.'
        : null
    };
  }

  async getMessages(conversationId, callerId) {
    const [convRows] = await db.query('SELECT * FROM in_app_conversations WHERE id = ?', [conversationId]);
    if (!convRows[0]) {
      const err = new Error('Conversation not found');
      err.code = 'NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const conv = convRows[0];
    if (conv.buyer_id !== callerId && conv.supplier_id !== callerId) {
      const err = new Error('You are not a participant in this conversation');
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }

    const [messages] = await db.query(
      'SELECT * FROM in_app_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId]
    );
    return { conversation: conv, messages };
  }
}

module.exports = new MessagingService();
