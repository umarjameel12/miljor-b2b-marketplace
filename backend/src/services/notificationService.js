'use strict';
// =============================================================================
// backend/src/services/notificationService.js
// MilJor Platform In-App Notification Service
// Provides recipient-isolated, persistent, deduplicated in-app notifications
// across all core platform lifecycle events.
// =============================================================================
const db = require('../config/db');
const crypto = require('node:crypto');
const {eventProjection} = require('./notificationEventPolicy');

class NotificationService {
  constructor(database=db){this.database=database;}

  async enqueueEvent(connection,event){
    if(!connection||typeof connection.query!=='function')throw Error('Transaction connection required');
    const allowed=['userId','role','eventType','eventKey','entityId'];
    if(Object.keys(event).some(field=>!allowed.includes(field)))throw Error('Unsupported notification field');
    if(!/^[1-9]\d*$/.test(String(event.userId))||!Number.isSafeInteger(Number(event.userId)))throw Error('Invalid recipient');
    if(typeof event.eventKey!=='string'||!event.eventKey.length||event.eventKey.length>120)throw Error('Invalid notification event key');
    eventProjection(event);
    const [users]=await connection.query('SELECT id,role FROM users WHERE id=?',[event.userId]);
    if(!users.length||users[0].role!==event.role)throw Error('Invalid notification recipient role');
    return connection.query(
      `INSERT INTO procurement_notifications
       (recipient_id,recipient_role,event_key,event_type,payload)
       VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,
      [event.userId,event.role,event.eventKey,event.eventType,JSON.stringify({entityId:Number(event.entityId),schemaVersion:1})]
    );
  }

  async getPreferences(userId){
    const [rows]=await this.database.query('SELECT locale,optional_email,optional_sms FROM notification_preferences WHERE user_id=?',[userId]);
    return rows[0]||{locale:'en',optional_email:1,optional_sms:0};
  }

  async setPreferences(userId,input){
    if(!input||Object.keys(input).some(field=>!['locale','optional_email','optional_sms'].includes(field))||
      !['en','ur'].includes(input.locale)||typeof input.optional_email!=='boolean'||typeof input.optional_sms!=='boolean')
      throw Object.assign(Error('Invalid notification preferences'),{statusCode:400});
    await this.database.query(
      `INSERT INTO notification_preferences(user_id,locale,optional_email,optional_sms) VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE locale=VALUES(locale),optional_email=VALUES(optional_email),optional_sms=VALUES(optional_sms)`,
      [userId,input.locale,input.optional_email?1:0,input.optional_sms?1:0]);
    return this.getPreferences(userId);
  }

  async processPending({limit=20,emailService,eventIds=null}={}){
    if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid notification batch limit');
    if(eventIds!==null&&(!Array.isArray(eventIds)||!eventIds.length||eventIds.length>100||
      eventIds.some(value=>!Number.isSafeInteger(value)||value<1)))throw Error('Invalid notification event scope');
    const email=emailService||require('./emailService');
    const totals={processed:0,projected:0,failed:0};
    for(let index=0;index<limit;index++){
      const connection=await this.database.getConnection();
      let notice;
      try{
        await connection.beginTransaction();
        const [rows]=await connection.query(
          `SELECT * FROM procurement_notifications WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.schemaVersion'))='1'
           AND status IN ('PENDING','FAILED')
           AND attempt_count<5 AND (next_attempt_at IS NULL OR next_attempt_at<=UTC_TIMESTAMP())
           ${eventIds?'AND id IN ('+eventIds.map(()=>'?').join(',')+')':''}
           ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,eventIds||[]);
        notice=rows[0];
        if(!notice){await connection.commit();break;}
        totals.processed++;
        const payload=typeof notice.payload==='string'?JSON.parse(notice.payload):notice.payload;
        if(payload?.schemaVersion!==1)throw Error('LEGACY_EVENT_REQUIRES_ADAPTER');
        const [users]=await connection.query('SELECT id,role,email FROM users WHERE id=?',[notice.recipient_id]);
        if(!users.length||users[0].role!==notice.recipient_role)throw Error('RECIPIENT_UNAVAILABLE');
        const [preferences]=await connection.query('SELECT locale,optional_email FROM notification_preferences WHERE user_id=?',[notice.recipient_id]);
        const preference=preferences[0]||{locale:'en',optional_email:1};
        const projection=eventProjection({eventType:notice.event_type,entityId:payload.entityId,locale:preference.locale});
        await this.createNotification({userId:notice.recipient_id,role:notice.recipient_role,
          eventType:notice.event_type,eventKey:notice.event_key,...projection,
          payload:{deepLink:projection.deepLink,entityId:payload.entityId}},connection);
        let channelError=null;
        if(projection.email&&(projection.mandatory||Number(preference.optional_email)===1)){
          if(typeof users[0].email!=='string'||!users[0].email.includes('@')){
            channelError='EMAIL_DESTINATION_UNAVAILABLE';
          }else{
            await connection.query('SAVEPOINT notice_email');
            try{
              await email.enqueueEmail(connection,{recipientEmail:users[0].email,recipientUserId:notice.recipient_id,
                templateName:'platform_notification',payload:projection,
                idempotencyKey:'notice:'+crypto.createHash('sha256').update(notice.recipient_id+':'+notice.event_key).digest('hex')});
            }catch(error){
              await connection.query('ROLLBACK TO SAVEPOINT notice_email');
              channelError='EMAIL_QUEUE_FAILED';
            }
            await connection.query('RELEASE SAVEPOINT notice_email');
          }
        }
        if(channelError){
          await connection.query("UPDATE procurement_notifications SET status='FAILED',attempt_count=attempt_count+1,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE),last_error_code=? WHERE id=?",[channelError,notice.id]);
          totals.failed++;
        }else{
          await connection.query("UPDATE procurement_notifications SET status='SENT',attempt_count=attempt_count+1,delivered_at=UTC_TIMESTAMP(),last_error_code=NULL WHERE id=?",[notice.id]);
        }
        await connection.commit();totals.projected++;
      }catch(error){
        await connection.rollback();
        if(!notice)throw error;
        await this.database.query(
          `UPDATE procurement_notifications SET status='FAILED',attempt_count=attempt_count+1,
           next_attempt_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE),last_error_code=?
           WHERE id=? AND status IN ('PENDING','FAILED') AND attempt_count=?`,
          ['NOTIFICATION_PROJECTION_FAILED',notice.id,notice.attempt_count]);
        totals.failed++;
      }finally{connection.release();}
    }
    return totals;
  }
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
  async createNotification({ userId, role, eventType, eventKey, title, message, payload = null },connection=this.database) {
    if (!userId || !role || !eventType || !eventKey || !title || !message) {
      throw new Error('Missing required notification fields');
    }

    const payloadJson = payload ? JSON.stringify(payload) : null;

    try {
      const [result] = await connection.query(
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

    const [rows] = await this.database.query(sql, params);
    return rows.map(r => ({
      ...r,
      payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload
    }));
  }

  /**
   * Gets the unread notification count for a user.
   */
  async getUnreadCount(userId) {
    const [[row]] = await this.database.query(
      'SELECT COUNT(*) as unread_count FROM platform_notifications WHERE user_id = ? AND is_read = 0',
      [userId]
    );
    return Number(row.unread_count || 0);
  }

  /**
   * Marks a specific notification as read, ensuring strict recipient ownership.
   */
  async markAsRead(userId, notificationId) {
    const [result] = await this.database.query(
      'UPDATE platform_notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND user_id = ? AND is_read = 0',
      [notificationId, userId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Marks all unread notifications as read for a user.
   */
  async markAllAsRead(userId) {
    const [result] = await this.database.query(
      'UPDATE platform_notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND is_read = 0',
      [userId]
    );
    return result.affectedRows;
  }
}

module.exports = new NotificationService();
module.exports.NotificationService = NotificationService;
