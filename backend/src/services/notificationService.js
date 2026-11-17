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
const {normalizePreferences,validatePreferences,deliveryPlan}=require('./notificationDeliveryPolicy');

class NotificationService {
  constructor(database=db){this.database=database;}

  async enqueueEvent(connection,event){
    if(!connection||typeof connection.query!=='function')throw Error('Transaction connection required');
    const allowed=['userId','role','eventType','eventKey','entityId','eventId','aggregateId','aggregateVersion','actorId','actorRole','occurredAt','causationId','correlationId','schemaVersion'];
    if(Object.keys(event).some(field=>!allowed.includes(field)))throw Error('Unsupported notification field');
    if(!/^[1-9]\d*$/.test(String(event.userId))||!Number.isSafeInteger(Number(event.userId)))throw Error('Invalid recipient');
    if(typeof event.eventKey!=='string'||!event.eventKey.length||event.eventKey.length>120)throw Error('Invalid notification event key');
    eventProjection(event);
    const [users]=await connection.query('SELECT id,role FROM users WHERE id=?',[event.userId]);
    if(!users.length||users[0].role!==event.role)throw Error('Invalid notification recipient role');
    const metadataFields=['eventId','aggregateId','aggregateVersion','actorId','actorRole','occurredAt','causationId','correlationId'];
    const hasMeta=event.schemaVersion===2||metadataFields.some(field=>event[field]!==undefined);
    if(event.schemaVersion!==undefined&&event.schemaVersion!==1&&event.schemaVersion!==2)
      throw Error('Invalid notification schema version');
    if(event.schemaVersion===1&&hasMeta)throw Error('Invalid notification schema version');
    const payloadMeta={entityId:Number(event.entityId),schemaVersion:hasMeta?2:1};
    if(hasMeta){
      // Opaque IDs are bounded printable tokens, never truncated or object-coerced.
      const validId=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[^\x21-\x7e]/.test(value);
      if(!validId(event.eventId,128)||event.eventId!==event.eventKey)throw Error('Invalid notification event identity');
      if(!validId(event.aggregateId,120))throw Error('Invalid notification aggregate ID');
      if(!Number.isSafeInteger(event.aggregateVersion)||event.aggregateVersion<0)throw Error('Invalid notification aggregate version');
      for(const field of ['causationId','correlationId']){
        if(!validId(event[field],128))throw Error('Invalid notification '+field);
        payloadMeta[field]=event[field];
      }
      const roles=['BUYER','SUPPLIER','ADMIN','SUPER_ADMIN','FINANCE_ADMIN','OPERATIONS_ADMIN','VERIFICATION_ADMIN','SUPPORT_ADMIN'];
      if(event.actorId==='SYSTEM'){
        if(event.actorRole!=='SYSTEM')throw Error('Invalid notification actor role');
        payloadMeta.actorId='SYSTEM';
      }else{
        if(!['number','string'].includes(typeof event.actorId)||!/^[1-9]\d*$/.test(String(event.actorId))||/\D/.test(String(event.actorId))||
          !Number.isSafeInteger(Number(event.actorId))||!roles.includes(event.actorRole))throw Error('Invalid notification actor');
        const actorId=Number(event.actorId);
        const [actors]=await connection.query('SELECT id,role FROM users WHERE id=?',[actorId]);
        if(!actors.length||actors[0].role!==event.actorRole)throw Error('Invalid notification actor role');
        payloadMeta.actorId=actorId;
      }
      payloadMeta.eventId=event.eventId;
      payloadMeta.aggregateId=event.aggregateId;
      payloadMeta.aggregateVersion=event.aggregateVersion;
      payloadMeta.actorRole=event.actorRole;
      let occurrence=event.occurredAt;
      if(occurrence===undefined){
        // Format UTC in SQL to avoid mysql session/driver/host timezone conversion.
        const [[clock]]=await connection.query("SELECT DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ') AS occurred_at");
        occurrence=clock?.occurred_at;
      }
      // Require an unambiguous ISO timestamp and reject calendar rollover (Feb 30).
      const match=typeof occurrence==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?Z$/.exec(occurrence);
      const date=match?new Date(occurrence):null;
      if(!match||match[0]!==occurrence||!Number.isFinite(date.getTime())||Number(match[1])<1000||
        date.getUTCFullYear()!==Number(match[1])||date.getUTCMonth()+1!==Number(match[2])||
        date.getUTCDate()!==Number(match[3])||date.getUTCHours()!==Number(match[4])||
        date.getUTCMinutes()!==Number(match[5])||date.getUTCSeconds()!==Number(match[6]))
        throw Error('Invalid notification occurrence time');
      payloadMeta.occurredAt=date.toISOString();
    }
    return connection.query(
      `INSERT INTO procurement_notifications
       (recipient_id,recipient_role,event_key,event_type,payload)
       VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,
      [event.userId,event.role,event.eventKey,event.eventType,JSON.stringify(payloadMeta)]
    );
  }

  async getPreferences(userId,connection=this.database){
    const [rows]=await connection.query('SELECT locale,optional_email,optional_sms,muted_info,quiet_start,quiet_end,timezone_offset_minutes FROM notification_preferences WHERE user_id=?',[userId]);
    return normalizePreferences(rows[0]);
  }

  async setPreferences(userId,input){
    const value=validatePreferences(input,await this.getPreferences(userId));
    await this.database.query(
      `INSERT INTO notification_preferences(user_id,locale,optional_email,optional_sms,muted_info,quiet_start,quiet_end,timezone_offset_minutes) VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE locale=VALUES(locale),optional_email=VALUES(optional_email),optional_sms=VALUES(optional_sms),
       muted_info=VALUES(muted_info),quiet_start=VALUES(quiet_start),quiet_end=VALUES(quiet_end),timezone_offset_minutes=VALUES(timezone_offset_minutes)`,
      [userId,value.locale,value.optional_email?1:0,value.optional_sms?1:0,value.muted_info?1:0,value.quiet_start,value.quiet_end,value.timezone_offset_minutes]);
    return this.getPreferences(userId);
  }

  async processPending({limit=20,emailService,eventIds=null,clock=()=>new Date()}={}){
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
          `SELECT * FROM procurement_notifications WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.schemaVersion')) IN ('1','2')
           AND status IN ('PENDING','FAILED')
           AND attempt_count<5 AND (next_attempt_at IS NULL OR next_attempt_at<=UTC_TIMESTAMP())
           ${eventIds?'AND id IN ('+eventIds.map(()=>'?').join(',')+')':''}
           ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,eventIds||[]);
        notice=rows[0];
        if(!notice){await connection.commit();break;}
        totals.processed++;
        const payload=typeof notice.payload==='string'?JSON.parse(notice.payload):notice.payload;
        if(payload?.schemaVersion!==1&&payload?.schemaVersion!==2)throw Error('LEGACY_EVENT_REQUIRES_ADAPTER');
        let reminderContext=null;
        if(notice.event_type==='CYCLE_CUTOFF_UPCOMING'){
          const match=/^cycle:([1-9]\d*):upcoming24h$/.exec(notice.event_key);
          reminderContext={contractId:payload.entityId,cycleId:match?Number(match[1]):null};
          if(!await require('./recurringReminderPolicy').isCurrent(connection,{buyerId:notice.recipient_id,...reminderContext})){
            await connection.query("UPDATE procurement_notifications SET status='FAILED',attempt_count=5,next_attempt_at=NULL,last_error_code='STALE_REMINDER_SUPPRESSED' WHERE id=?",[notice.id]);
            await connection.commit();totals.failed++;continue;
          }
        }
        const [users]=await connection.query('SELECT id,role,email FROM users WHERE id=?',[notice.recipient_id]);
        if(!users.length||users[0].role!==notice.recipient_role)throw Error('RECIPIENT_UNAVAILABLE');
        const preference=await this.getPreferences(notice.recipient_id,connection);
        const projection=eventProjection({eventType:notice.event_type,entityId:payload.entityId,locale:notice.projected_locale||preference.locale});
        const plan=deliveryPlan({projection,preference,now:clock(),occurredAt:notice.created_at||clock(),digestEnabled:process.env.NOTIFICATION_DIGEST_ENABLED==='true'});
        if(plan.stale){
          await connection.query("UPDATE procurement_notifications SET status='SUPPRESSED',last_error_code='STALE_NOTIFICATION_SUPPRESSED',attempt_count=attempt_count+1 WHERE id=?",[notice.id]);
          await connection.commit();continue;
        }
        if(!plan.muted)await this.createNotification({userId:notice.recipient_id,role:notice.recipient_role,
          eventType:notice.event_type,eventKey:notice.event_key,...projection,
          visibleUntil:plan.visibleUntil,
          payload:{deepLink:projection.deepLink,entityId:payload.entityId}},connection);
        if(plan.digest){
          const ready=new Date(clock().getTime()+24*3600000);
          await connection.query(`INSERT INTO notification_digest_events(notice_id,recipient_id,ready_at)
            VALUES (?,?,?) ON DUPLICATE KEY UPDATE id=id`,[notice.id,notice.recipient_id,ready]);
        }
        let channelError=null;
        if(plan.sendEmail&&!plan.digest){
          if(typeof users[0].email!=='string'||!users[0].email.includes('@')){
            channelError='EMAIL_DESTINATION_UNAVAILABLE';
          }else{
            await connection.query('SAVEPOINT notice_email');
            try{
              const queued=await email.enqueueEmail(connection,{recipientEmail:users[0].email,recipientUserId:notice.recipient_id,
                templateName:'platform_notification',payload:{...projection,...(reminderContext?{reminderContext}:{})},
                idempotencyKey:'notice:'+crypto.createHash('sha256').update(notice.recipient_id+':'+notice.event_key).digest('hex')});
              if(!projection.mandatory){
                const notBefore=await this.reserveOptionalEmailSlot(connection,notice.recipient_id,plan.notBefore||clock(),preference);
                await connection.query("UPDATE transactional_email_outbox SET next_attempt_at=? WHERE id=? AND status='QUEUED'",[notBefore,queued.outbox_id]);
              }
            }catch(error){
              await connection.query('ROLLBACK TO SAVEPOINT notice_email');
              channelError='EMAIL_QUEUE_FAILED';
            }
            await connection.query('RELEASE SAVEPOINT notice_email');
          }
        }
        if(channelError){
          await connection.query("UPDATE procurement_notifications SET status='FAILED',attempt_count=attempt_count+1,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE),last_error_code=?,projected_locale=COALESCE(projected_locale,?) WHERE id=?",[channelError,projection.locale,notice.id]);
          totals.failed++;
          if(projection.mandatory)await this.alertDeliveryFailure(connection,notice.id,channelError);
        }else if(plan.muted){
          await connection.query("UPDATE procurement_notifications SET status='SUPPRESSED',last_error_code='ROUTINE_MUTED',attempt_count=attempt_count+1 WHERE id=?",[notice.id]);
        }else{
          await connection.query("UPDATE procurement_notifications SET status='SENT',attempt_count=attempt_count+1,delivered_at=UTC_TIMESTAMP(),last_error_code=NULL,projected_locale=COALESCE(projected_locale,?) WHERE id=?",[projection.locale,notice.id]);
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

  async reserveOptionalEmailSlot(connection,userId,earliest,preference={}){
    const configured=Number(process.env.NOTIFICATION_OPTIONAL_EMAIL_LIMIT_PER_HOUR||20);
    const cap=Number.isInteger(configured)&&configured>0&&configured<=1000?configured:20;
    let first=new Date(earliest);
    const hour=new Date(first);
    hour.setUTCMinutes(0,0,0);
    for(let index=0;index<48;index++){
      const quiet=require('./notificationDeliveryPolicy').quietUntil(normalizePreferences(preference),new Date(Math.max(first.getTime(),hour.getTime())));
      if(quiet){first=quiet;hour.setTime(quiet.getTime());hour.setUTCMinutes(0,0,0);continue;}
      await connection.query(`INSERT INTO notification_email_budgets(user_id,hour_start,used) VALUES (?,?,0)
        ON DUPLICATE KEY UPDATE user_id=user_id`,[userId,hour]);
      const [[budget]]=await connection.query('SELECT used FROM notification_email_budgets WHERE user_id=? AND hour_start=? FOR UPDATE',[userId,hour]);
      if(Number(budget.used)<cap){
        await connection.query('UPDATE notification_email_budgets SET used=used+1 WHERE user_id=? AND hour_start=?',[userId,hour]);
        return new Date(Math.max(first.getTime(),hour.getTime()));
      }
      hour.setUTCHours(hour.getUTCHours()+1);
    }
    throw Error('OPTIONAL_EMAIL_BACKLOG_LIMIT');
  }

  async alertDeliveryFailure(connection,noticeId,errorCode){
    const [admins]=await connection.query("SELECT id,role FROM users WHERE role IN ('ADMIN','SUPER_ADMIN')");
    for(const admin of admins.filter(row=>['ADMIN','SUPER_ADMIN'].includes(row.role))){
      await this.createNotification({userId:admin.id,role:admin.role,eventType:'NOTIFICATION_DELIVERY_EXCEPTION',
        eventKey:'notice-failure:'+noticeId+':'+errorCode,title:'Transactional notification needs attention',
        message:'A required notification channel failed. Review the delivery exception queue.',
        payload:{deepLink:'/admin',noticeId}},connection);
    }
  }

  async processDigests({limit=20,emailService}={}){
    if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid digest batch limit');
    const email=emailService||require('./emailService');
    const connection=await this.database.getConnection();
    const totals={queued:0,suppressed:0,failed:0};
    try{
      await connection.beginTransaction();
      const [due]=await connection.query(`SELECT id,recipient_id FROM notification_digest_events
        WHERE status='PENDING' AND ready_at<=UTC_TIMESTAMP() ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED`,[limit]);
      const groups=new Map();
      for(const item of due){if(!groups.has(item.recipient_id))groups.set(item.recipient_id,[]);groups.get(item.recipient_id).push(item.id);}
      for(const [userId,ids] of groups){
        await connection.query('SAVEPOINT digest_recipient');
        try{
        const preference=await this.getPreferences(userId,connection);
        const [[user]]=await connection.query('SELECT id,role,email,UTC_TIMESTAMP() AS db_now FROM users WHERE id=?',[userId]);
        let status='SUPPRESSED',errorCode=null;
        if(preference.optional_email&&!preference.muted_info){
          if(!user?.email){status='FAILED';errorCode='EMAIL_DESTINATION_UNAVAILABLE';}
          else{
            const now=new Date(user.db_now),projection={locale:preference.locale,mandatory:false,
              title:preference.locale==='ur'?'آپ کی روزانہ کی اطلاعات':'Your daily updates',
              message:preference.locale==='ur'?`${ids.length} نئی معمول کی اطلاعات دستیاب ہیں۔`:`${ids.length} routine updates are available.`,deepLink:'/profile'};
            const {quietUntil}=require('./notificationDeliveryPolicy');
            const notBefore=await this.reserveOptionalEmailSlot(connection,userId,quietUntil(preference,now)||now,preference);
            const queued=await email.enqueueEmail(connection,{recipientEmail:user.email,recipientUserId:userId,
              templateName:'platform_notification',payload:projection,
              idempotencyKey:'digest:'+crypto.createHash('sha256').update(userId+':'+ids.join(',')).digest('hex')});
            await connection.query("UPDATE transactional_email_outbox SET next_attempt_at=? WHERE id=? AND status='QUEUED'",[notBefore,queued.outbox_id]);
            status='QUEUED';
          }
        }
        await connection.query('UPDATE notification_digest_events SET status=?,processed_at=UTC_TIMESTAMP(),last_error_code=? WHERE id IN (?)',[status,errorCode,ids]);
        totals[status==='QUEUED'?'queued':status==='FAILED'?'failed':'suppressed']++;
        }catch(error){
          await connection.query('ROLLBACK TO SAVEPOINT digest_recipient');
          await connection.query("UPDATE notification_digest_events SET status='FAILED',processed_at=UTC_TIMESTAMP(),last_error_code='DIGEST_QUEUE_FAILED' WHERE id IN (?)",[ids]);
          totals.failed++;
        }
        await connection.query('RELEASE SAVEPOINT digest_recipient');
      }
      await connection.commit();return totals;
    }catch(error){await connection.rollback();throw error;}
    finally{connection.release();}
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
  async createNotification({ userId, role, eventType, eventKey, title, message, payload = null,visibleUntil=null },connection=this.database) {
    if (!userId || !role || !eventType || !eventKey || !title || !message) {
      throw new Error('Missing required notification fields');
    }

    const payloadJson = payload ? JSON.stringify(payload) : null;

    try {
      const [result] = await connection.query(
        `INSERT INTO platform_notifications 
         (user_id, role, event_type, event_key, title, message, payload, is_read, created_at${visibleUntil?', visible_until':''})
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW()${visibleUntil?', ?':''})`,
        [userId, role, eventType, eventKey, title, message, payloadJson,...(visibleUntil?[visibleUntil]:[])]
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
    let sql = 'SELECT id, role, event_type, event_key, title, message, payload, is_read, created_at, read_at FROM platform_notifications WHERE user_id = ? AND (visible_until IS NULL OR visible_until>UTC_TIMESTAMP())';
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
      'SELECT COUNT(*) as unread_count FROM platform_notifications WHERE user_id = ? AND is_read = 0 AND (visible_until IS NULL OR visible_until>UTC_TIMESTAMP())',
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
