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

  async getOrCreateConversation({ buyerId, supplierId, orderId = null, poolId = null, callerId, callerRole }) {
    const fail = (code, message, statusCode = 403) => {
      const error = new Error(message);
      error.code = code;
      error.statusCode = statusCode;
      throw error;
    };
    const id = (value) => {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 1) fail('INVALID_PARTICIPANT', 'Valid participant identity required.', 400);
      return number;
    };
    const buyer = id(buyerId);
    const supplier = id(supplierId);
    const caller = id(callerId);
    if (buyer === supplier || !['BUYER', 'SUPPLIER'].includes(callerRole) ||
        (callerRole === 'BUYER' && caller !== buyer) ||
        (callerRole === 'SUPPLIER' && caller !== supplier)) {
      fail('CONVERSATION_FORBIDDEN', 'You cannot create a conversation for other participants.');
    }
    if (orderId && poolId) fail('INVALID_CONVERSATION_CONTEXT', 'Choose either order or pool context.', 400);
    if (!orderId && !poolId) fail('CONVERSATION_CONTEXT_REQUIRED', 'An actual order or pool context is required.', 400);
    const [participants] = await db.query(
      "SELECT id,role,verification_status FROM users WHERE id IN (?,?)", [buyer, supplier]
    );
    if (!participants.some(row => Number(row.id) === buyer && row.role === 'BUYER' && row.verification_status === 'VERIFIED') ||
        !participants.some(row => Number(row.id) === supplier && row.role === 'SUPPLIER' && row.verification_status === 'VERIFIED')) {
      fail('INVALID_CONVERSATION_PARTICIPANTS', 'Verified buyer and supplier are required.');
    }
    let contextId;
    let column;
    if (orderId) {
      contextId = id(orderId);
      column = 'order_id';
      const [orders] = await db.query(
        'SELECT id FROM orders WHERE id=? AND buyer_id=? AND supplier_id=?',
        [contextId, buyer, supplier]
      );
      if (!orders.length) fail('ORDER_CONTEXT_FORBIDDEN', 'Order does not belong to these participants.');
    } else {
      contextId = id(poolId);
      column = 'pool_id';
      const [pools] = await db.query('SELECT id FROM pools WHERE id=? AND supplier_id=?', [contextId, supplier]);
      if (!pools.length) fail('POOL_CONTEXT_FORBIDDEN', 'Pool does not belong to this supplier.');
      const [res] = await db.query(
        'SELECT id FROM reservations WHERE pool_id=? AND buyer_id=? LIMIT 1',
        [contextId, buyer]
      );
      if (!res.length) fail('POOL_CONTEXT_FORBIDDEN', 'Buyer is not a participant in this pool.');
    }
    const [existing] = await db.query(
      `SELECT * FROM in_app_conversations WHERE buyer_id=? AND supplier_id=? AND ${column}=? ORDER BY id LIMIT 1`,
      [buyer,supplier,contextId]
    );
    if (existing.length) return existing[0];
    // UUID avoids timestamp-based collisions under concurrent conversation creation.
    const { randomUUID } = require('crypto');
    const code = 'CONV-' + randomUUID();
    const [inserted] = await db.query(
      `INSERT INTO in_app_conversations (conversation_code,order_id,pool_id,buyer_id,supplier_id)
       VALUES (?,?,?,?,?)`,
      [code, orderId ? contextId : null, poolId ? contextId : null, buyer, supplier]
    );
    const [created] = await db.query('SELECT * FROM in_app_conversations WHERE id=?', [inserted.insertId]);
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
    if (hasWarning) {
      const err = new Error('Direct contact details are not allowed. Keep communications inside MilJor.');
      err.code = 'DIRECT_CONTACT_NOT_ALLOWED';
      err.statusCode = 422;
      throw err;
    }

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
