'use strict';
// UCP transactional IN-APP notification writer.
// Called with the SAME mysql2 transaction connection as the committed domain mutation.
// Domain service is responsible for resolving authorized recipients; never accept recipient IDs from the buyer request.
const {getEventDefinition,buildEventKey} = require('./ucpNotificationEventCatalog');
const ALLOWED_ROLES = new Set(['BUYER','SUPPLIER','ADMIN','SUPER_ADMIN']);
const SAFE_PAYLOAD_KEYS = new Set(['pool_id','order_id','reservation_id','delivery_id','dispute_id','status','mode','quantity','unit','notification_path']);
function sanitizePayload(payload) {
  if (payload == null) return null;
  if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error('INVALID_NOTIFICATION_PAYLOAD');
  const safe = {};
  for (const [key,value] of Object.entries(payload)) {
    if (!SAFE_PAYLOAD_KEYS.has(key)) throw new Error('UNSAFE_NOTIFICATION_PAYLOAD_KEY');
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean' && value !== null)
      throw new Error('INVALID_NOTIFICATION_PAYLOAD_VALUE');
    if (typeof value === 'string' && value.length > 256) throw new Error('NOTIFICATION_PAYLOAD_TOO_LONG');
    safe[key] = value;
  }
  return Object.keys(safe).length ? safe : null;
}
function validateRecipient(recipient) {
  if (!recipient || !Number.isSafeInteger(recipient.userId) || recipient.userId <= 0
      || !ALLOWED_ROLES.has(recipient.role)) throw new Error('INVALID_NOTIFICATION_RECIPIENT');
}
/**
 * Must execute BEFORE commit, on the owning business transaction connection.
 * Failing SQL should roll back the domain mutation instead of silently losing critical in-app receipt.
 * EMAIL dispatch must be queued in a separate transactional outbox integration, not sent inline.
 */
async function recordInAppOnConnection(connection, {type,aggregateId,aggregateVersion,transitionId,recipients,title,message,payload}) {
  if (!connection || typeof connection.query !== 'function') throw new Error('TRANSACTION_CONNECTION_REQUIRED');
  getEventDefinition(type);
  if (!Array.isArray(recipients) || !recipients.length || recipients.length > 100) throw new Error('INVALID_NOTIFICATION_RECIPIENTS');
  if (typeof title !== 'string' || !title.trim() || title.length > 140
    || typeof message !== 'string' || !message.trim() || message.length > 1000)
    throw new Error('INVALID_NOTIFICATION_CONTENT');
  const key = buildEventKey({type,aggregateId,aggregateVersion,transitionId});
  const json = sanitizePayload(payload);
  const seen = new Set();
  let inserted = 0;
  for (const recipient of recipients) {
    validateRecipient(recipient);
    if (seen.has(recipient.userId)) continue;
    seen.add(recipient.userId);
    // Existing unique (user_id, event_key) enforces replay safety.
    const [result] = await connection.query(
      `INSERT INTO platform_notifications
       (user_id,role,event_type,event_key,title,message,payload,is_read,created_at)
       VALUES (?,?,?,?,?,?,?,0,NOW())
       ON DUPLICATE KEY UPDATE id=id`,
      [recipient.userId,recipient.role,type,key,title.trim(),message.trim(),json ? JSON.stringify(json) : null]
    );
    if (result.affectedRows === 1) inserted++;
  }
  return {eventKey:key,inserted,recipients:seen.size};
}
module.exports = {recordInAppOnConnection,sanitizePayload};
