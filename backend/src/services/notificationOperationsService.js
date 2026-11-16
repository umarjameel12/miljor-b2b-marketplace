'use strict';
const db=require('../config/db');
const crypto=require('node:crypto');
const allowed=new Set(['ADMIN','SUPER_ADMIN','SUPPORT_ADMIN']);
const fail=(message,statusCode=403)=>Object.assign(Error(message),{statusCode});
class NotificationOperationsService{
  constructor(database=db){this.database=database;}
  async assertAdmin(actor,connection=this.database){
    if(!Number.isSafeInteger(Number(actor?.id))||Number(actor.id)<1)throw fail('Notification operations access denied');
    const [[user]]=await connection.query(
      'SELECT role,verification_status,buyer_trust_status FROM users WHERE id=?'+(connection===this.database?'':' FOR UPDATE'),[actor.id]);
    if(!user||!allowed.has(user.role)||user.verification_status==='BLOCKED'||user.buyer_trust_status==='SUSPENDED')throw fail('Notification operations access denied');
  }
  async health({actor}){
    await this.assertAdmin(actor);
    const [[projection]]=await this.database.query(`SELECT
      SUM(status='PENDING') AS pending,SUM(status='FAILED') AS failed,
      SUM(status='FAILED' AND attempt_count>=5) AS deadLetter,SUM(status='SUPPRESSED') AS suppressed
      FROM procurement_notifications`);
    const [[email]]=await this.database.query(`SELECT SUM(status='QUEUED') AS queued,SUM(status='SENDING') AS sending,
      SUM(status='FAILED') AS failed,SUM(status='FAILED' AND attempt_count>=3) AS terminalFailed FROM transactional_email_outbox`);
    const [rows]=await this.database.query(`SELECT id,event_type,status,attempt_count,last_error_code,created_at
      FROM procurement_notifications WHERE status='FAILED' ORDER BY id DESC LIMIT 50`);
    const counts=object=>Object.fromEntries(Object.entries(object).map(([key,value])=>[key,Number(value)||0]));
    const [emailRows]=await this.database.query(`SELECT id,template_name,status,attempt_count,last_error,created_at
      FROM transactional_email_outbox WHERE status='FAILED' ORDER BY id DESC LIMIT 50`);
    const failures=rows.map(row=>({id:row.id,channel:'EVENT',eventType:row.event_type,
      status:row.status,attemptCount:row.attempt_count,lastErrorCode:row.last_error_code,createdAt:row.created_at}));
    for(const row of emailRows)failures.push({id:row.id,channel:'EMAIL',eventType:row.template_name,status:row.status,
      attemptCount:row.attempt_count,lastErrorCode:/^[A-Z_]{1,80}$/.test(row.last_error||'')?row.last_error:'EMAIL_DELIVERY_FAILED',createdAt:row.created_at});
    return {projection:counts(projection),email:counts(email),failures};
  }
  async retryNotice({actor,id,reason}){
    if(!Number.isSafeInteger(Number(id))||Number(id)<1||typeof reason!=='string'||reason.trim().length<10||reason.length>500)
      throw fail('A valid event and recovery reason of 10–500 characters are required',400);
    const connection=await this.database.getConnection();
    try{
      await connection.beginTransaction();
      await this.assertAdmin(actor,connection);
      const [[notice]]=await connection.query('SELECT id,recipient_id,event_key,status,attempt_count FROM procurement_notifications WHERE id=? FOR UPDATE',[id]);
      if(!notice)throw fail('Notification event not found',404);
      if(notice.status!=='FAILED')throw fail('Only a failed notification can be retried',409);
      const key='notice:'+crypto.createHash('sha256').update(notice.recipient_id+':'+notice.event_key).digest('hex');
      const [[email]]=await connection.query(`SELECT id,recipient_user_id,status,attempt_count,
        (claim_token IS NOT NULL AND claim_expires_at>NOW()) AS claim_active
        FROM transactional_email_outbox WHERE idempotency_key=? FOR UPDATE`,[key]);
      if(email&&Number(email.recipient_user_id)!==Number(notice.recipient_id))
        throw fail('Linked email does not belong to the notification recipient',409);
      if(email&&(email.status!=='FAILED'||Number(email.claim_active)))
        throw fail('Linked email is already queued, in flight, or delivered',409);
      await connection.query(`INSERT INTO notification_admin_events(actor_id,notice_id,action,previous_attempt_count,previous_email_attempt_count,reason)
        VALUES (?,?,'RETRY',?,?,?)`,[actor.id,id,notice.attempt_count,email?.attempt_count??null,reason.trim()]);
      if(email?.status==='FAILED')await connection.query(`UPDATE transactional_email_outbox SET status='QUEUED',attempt_count=0,
        claim_token=NULL,claim_expires_at=NULL,next_attempt_at=NULL WHERE id=? AND status='FAILED'`,[email.id]);
      await connection.query(`UPDATE procurement_notifications SET status='PENDING',attempt_count=0,next_attempt_at=NULL,last_error_code=NULL
        WHERE id=? AND status='FAILED'`,[id]);
      await connection.commit();return {id:Number(id),status:'PENDING'};
    }catch(error){await connection.rollback();throw error;}
    finally{connection.release();}
  }
  async alertExhaustedEmails({limit=20}={}){
    if(!Number.isInteger(limit)||limit<1||limit>100)throw fail('Invalid batch limit',400);
    const [rows]=await this.database.query(`SELECT e.id FROM transactional_email_outbox e
      WHERE e.status='FAILED' AND e.attempt_count>=3
      AND (e.template_name='UCP_NOTIFICATION' OR JSON_EXTRACT(e.payload_json,'$.mandatory')=true)
      AND NOT EXISTS (SELECT 1 FROM platform_notifications alerted
        WHERE alerted.event_type='NOTIFICATION_DELIVERY_EXCEPTION'
          AND alerted.event_key=CONCAT('notice-failure:email-',e.id,':EMAIL_DELIVERY_EXHAUSTED'))
      ORDER BY e.id ASC LIMIT ?`,[limit]);
    const service=require('./notificationService');
    for(const row of rows)await service.alertDeliveryFailure(this.database,'email-'+row.id,'EMAIL_DELIVERY_EXHAUSTED');
    return {checked:rows.length};
  }
  async alertExhaustedEvents({limit=20}={}){
    if(!Number.isInteger(limit)||limit<1||limit>100)throw fail('Invalid batch limit',400);
    const {eventTypes,mandatory}=require('./notificationEventPolicy');
    const types=eventTypes.filter(mandatory);
    if(!types.length)return {checked:0};
    // Apply mandatory eligibility before LIMIT so older optional failures cannot
    // occupy the bounded scan forever. Earlier per-event alerts also count.
    const [rows]=await this.database.query(`SELECT n.id FROM procurement_notifications n
      WHERE n.status='FAILED' AND n.attempt_count>=5
      AND n.event_type IN (${types.map(()=>'?').join(',')})
      AND NOT EXISTS (SELECT 1 FROM platform_notifications alerted
        WHERE alerted.event_type='NOTIFICATION_DELIVERY_EXCEPTION'
          AND alerted.event_key LIKE CONCAT('notice-failure:',n.id,':%'))
      ORDER BY n.id ASC LIMIT ?`,[...types,limit]);
    const service=require('./notificationService');
    for(const row of rows)await service.alertDeliveryFailure(this.database,row.id,'EVENT_DELIVERY_EXHAUSTED');
    return {checked:rows.length};
  }
  async retryEmail({actor,id,reason}){
    if(!Number.isSafeInteger(Number(id))||Number(id)<1||typeof reason!=='string'||reason.trim().length<10||reason.length>500)
      throw fail('A valid email event and recovery reason of 10–500 characters are required',400);
    const connection=await this.database.getConnection();
    try{
      await connection.beginTransaction();
      await this.assertAdmin(actor,connection);
      const [[email]]=await connection.query(`SELECT id,status,attempt_count,(claim_token IS NOT NULL AND claim_expires_at>NOW()) AS claim_active
        FROM transactional_email_outbox WHERE id=? FOR UPDATE`,[id]);
      if(!email)throw fail('Email event not found',404);
      if(email.status!=='FAILED'||Number(email.claim_active))throw fail('Only a failed email without an active delivery claim can be retried',409);
      await connection.query(`INSERT INTO notification_admin_events(actor_id,email_id,action,previous_attempt_count,previous_email_attempt_count,reason)
        VALUES (?,?,'EMAIL_RETRY',0,?,?)`,[actor.id,id,email.attempt_count,reason.trim()]);
      await connection.query(`UPDATE transactional_email_outbox SET status='QUEUED',attempt_count=0,
        claim_token=NULL,claim_expires_at=NULL,next_attempt_at=NULL WHERE id=? AND status='FAILED'`,[id]);
      await connection.commit();return {id:Number(id),status:'QUEUED'};
    }catch(error){await connection.rollback();throw error;}
    finally{connection.release();}
  }
}
module.exports=new NotificationOperationsService();
module.exports.NotificationOperationsService=NotificationOperationsService;
