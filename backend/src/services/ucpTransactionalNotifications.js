'use strict';
// UCP transactional in-app receipts and critical email outbox writer.
// Called with the SAME mysql2 transaction connection as the committed domain mutation.
// Domain service is responsible for resolving authorized recipients; never accept recipient IDs from the buyer request.
const {getEventDefinition,buildEventKey} = require('./ucpNotificationEventCatalog');
const crypto = require('node:crypto');
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
 * Critical EMAIL is queued on the same transaction; transport runs after commit.
 */
async function recordInAppOnConnection(connection, {type,aggregateId,aggregateVersion,transitionId,recipients,title,message,payload}) {
  if (!connection || typeof connection.query !== 'function') throw new Error('TRANSACTION_CONNECTION_REQUIRED');
  const definition=getEventDefinition(type);
  if (!Array.isArray(recipients) || !recipients.length || recipients.length > 100) throw new Error('INVALID_NOTIFICATION_RECIPIENTS');
  if (typeof title !== 'string' || !title.trim() || title.length > 140
    || typeof message !== 'string' || !message.trim() || message.length > 1000)
    throw new Error('INVALID_NOTIFICATION_CONTENT');
  const key = buildEventKey({type,aggregateId,aggregateVersion,transitionId});
  const json = sanitizePayload(payload);
  const seen = new Set();
  let inserted = 0;
  let emailUnavailable = 0;
  // Validate the entire batch before writing anything, including duplicate roles.
  const roles=new Map();
  for(const recipient of recipients){
    validateRecipient(recipient);
    if(roles.has(recipient.userId)&&roles.get(recipient.userId)!==recipient.role)
      throw Error('NOTIFICATION_RECIPIENT_ROLE_CONFLICT');
    roles.set(recipient.userId,recipient.role);
  }
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
    if(definition.channels.includes('EMAIL')){
      const [users]=await connection.query('SELECT id,role,email FROM users WHERE id=?',[recipient.userId]);
      if(!users.length||users[0].role!==recipient.role)throw Error('NOTIFICATION_RECIPIENT_ROLE_MISMATCH');
      if(typeof users[0].email==='string'&&users[0].email.includes('@')){
        await require('./emailService').enqueueEmail(connection,{
          recipientEmail:users[0].email,recipientUserId:recipient.userId,
          templateName:'platform_notification',payload:{title:title.trim(),message:message.trim(),locale:'en'},
          idempotencyKey:'ucp:'+crypto.createHash('sha256').update(recipient.userId+':EMAIL:'+key).digest('hex')
        });
      }else{
        // Keep the committed in-app receipt. No fabricated email delivery claim.
        emailUnavailable++;
      }
    }
  }
  return {eventKey:key,inserted,recipients:seen.size,emailUnavailable};
}

// These resolvers read persisted ownership on the caller's transaction, never
// recipient lists supplied by an HTTP client. They expose no peer identity data.
async function recordOrderOnConnection(connection,{orderId,type,transitionId}){
  if(!Number.isSafeInteger(Number(orderId))||Number(orderId)<1)throw Error('INVALID_ORDER');
  const [orders]=await connection.query('SELECT id,buyer_id,supplier_id FROM orders WHERE id=?',[orderId]);
  if(!orders.length)throw Error('NOTIFICATION_ORDER_NOT_FOUND');
  const order=orders[0];
  const recipients=[{userId:Number(order.buyer_id),role:'BUYER'},{userId:Number(order.supplier_id),role:'SUPPLIER'}];
  for(const recipient of recipients){
    const [users]=await connection.query('SELECT id,role FROM users WHERE id=?',[recipient.userId]);
    if(!users.length||users[0].role!==recipient.role)throw Error('NOTIFICATION_RECIPIENT_ROLE_MISMATCH');
  }
  const title=type.split('.').pop().toLowerCase().replaceAll('_',' ');
  return recordInAppOnConnection(connection,{type,aggregateId:'order-'+orderId,aggregateVersion:1,transitionId,
    recipients,title:title[0].toUpperCase()+title.slice(1),
    message:'A change to your order has been recorded. Open your order in MilJor to review it.',
    payload:{order_id:Number(orderId),notification_path:'/orders'}});
}
async function recordReservationEventOnConnection(connection,event){
  const mapping={RESERVATION_CREATED:'UCP.RESERVATION_CREATED',RESERVATION_QUANTITY_INCREASED:'UCP.RESERVATION_UPDATED',
    RESERVATION_QUANTITY_DECREASED:'UCP.RESERVATION_UPDATED',RESERVATION_CANCELLED:'UCP.RESERVATION_CANCELLED',
    TARGET_REACHED:'UCP.TARGET_REACHED',POOL_TIER_CHANGED:'UCP.TIER_CHANGED',
    POOL_QUALIFIED:'UCP.CONFIRMATION_REQUIRED',POOL_UNQUALIFIED:'UCP.POOL_FAILED',
    SUPPLIER_OFFER_ACCEPTED:'UCP.PRICE_LOCKED',SUPPLIER_OFFER_REJECTED:'UCP.POOL_FAILED',
    BUYER_OFFER_ACCEPTED:'UCP.PRICE_LOCKED',BUYER_OFFER_DECLINED:'UCP.RESERVATION_CANCELLED'};
  const type=mapping[event.event_type];
  if(!type)return;
  const [pools]=await connection.query('SELECT supplier_id FROM pools WHERE id=?',[event.pool_id]);
  if(!pools.length)throw Error('NOTIFICATION_POOL_NOT_FOUND');
  const individual=/^RESERVATION_|^BUYER_OFFER_/.test(event.event_type);
  const [buyers]=await connection.query(individual?
    'SELECT buyer_id FROM reservations WHERE id=? AND pool_id=?':
    "SELECT DISTINCT buyer_id FROM reservations WHERE pool_id=? AND status IN ('RESERVED','PRICE_LOCKED','ORDERED')",
    individual?[event.reservation_id,event.pool_id]:[event.pool_id]);
  const recipients=[{userId:Number(pools[0].supplier_id),role:'SUPPLIER'},
    ...buyers.map(row=>({userId:Number(row.buyer_id),role:'BUYER'}))];
  const title=type.split('.').pop().toLowerCase().replaceAll('_',' ');
  for(let offset=0;offset<recipients.length;offset+=100){
    await recordInAppOnConnection(connection,{type,aggregateId:'pool-'+event.pool_id,aggregateVersion:1,
      transitionId:event.event_id,recipients:recipients.slice(offset,offset+100),
      title:title[0].toUpperCase()+title.slice(1),message:'A change to your pool commitment has been recorded. Open MilJor to review it.',
      payload:{pool_id:Number(event.pool_id),notification_path:'/pools'}});
  }
}
async function recordFlashOnConnection(connection,{flashId,type,transitionId}){
  const [offers]=await connection.query('SELECT supplier_id FROM flash_pools WHERE id=?',[flashId]);
  if(!offers.length)throw Error('NOTIFICATION_FLASH_NOT_FOUND');
  const [buyers]=await connection.query("SELECT DISTINCT buyer_id FROM flash_purchase_holds WHERE flash_pool_id=? AND status IN ('HELD','PAYMENT_PENDING','PAID')",[flashId]);
  const recipients=[{userId:Number(offers[0].supplier_id),role:'SUPPLIER'},
    ...buyers.map(row=>({userId:Number(row.buyer_id),role:'BUYER'}))];
  const title=type.split('.').pop().toLowerCase().replaceAll('_',' ');
  for(let offset=0;offset<recipients.length;offset+=100){
    await recordInAppOnConnection(connection,{type,aggregateId:'flash-'+flashId,aggregateVersion:1,transitionId,
      recipients:recipients.slice(offset,offset+100),title:'Flash '+title,
      message:'A change to your Flash pool has been recorded. Open MilJor to review it.',
      payload:{pool_id:Number(flashId),mode:'FLASH',notification_path:'/pools'}});
  }
}
module.exports = {recordInAppOnConnection,recordOrderOnConnection,recordReservationEventOnConnection,recordFlashOnConnection,sanitizePayload};
