'use strict';
const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function recordFlashReminder(conn,{flashId,kind,commitmentId,deadlineUtc,threshold,recipients,type}){
  const reminderKey=hash(['FLASH',kind,commitmentId,deadlineUtc,threshold]);
  const [existing]=await conn.query(`SELECT id FROM system_audit_logs WHERE entity_name='flash_pools' AND entity_id=?
    AND action='FLASH_TIMER_REMINDER' AND JSON_UNQUOTE(JSON_EXTRACT(new_value,'$.reminder_key'))=? LIMIT 1`,[flashId,reminderKey]);
  if(existing.length)return 0;
  await conn.query(`INSERT INTO system_audit_logs(actor_id,actor_role,action,entity_name,entity_id,new_value)
    VALUES (NULL,'SYSTEM','FLASH_TIMER_REMINDER','flash_pools',?,?)`,[flashId,JSON.stringify({reminder_key:reminderKey,
      kind,commitment_id:Number(commitmentId),deadline_utc:deadlineUtc,threshold_seconds:threshold})]);
  const notices=require('./ucpTransactionalNotifications');
  for(let offset=0;offset<recipients.length;offset+=100){
    await notices.recordInAppOnConnection(conn,{type,aggregateId:`flash-${kind}-${commitmentId}`,aggregateVersion:1,
      transitionId:reminderKey,recipients:recipients.slice(offset,offset+100),
      title:kind==='HOLD'?'Flash purchase hold expiring':'Flash pool closing soon',
      message:'A deadline for your Flash offer or hold is approaching. Open MilJor to review it.',
      payload:{pool_id:Number(flashId),mode:'FLASH',notification_path:'/flash-pools'},
      actorId:'SYSTEM',actorRole:'SYSTEM',causationId:reminderKey});
  }
  return 1;
}

async function recordFlashTimerReminders(conn,flashId){
  const [[offer]]=await conn.query(
    `SELECT id,supplier_id,status,created_at,DATE_FORMAT(expiry_time,'%Y-%m-%dT%H:%i:%s.%f') AS deadline_utc,
       TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),expiry_time) AS seconds_remaining,
       TIMESTAMPDIFF(SECOND,created_at,expiry_time) AS window_seconds
     FROM flash_pools WHERE id=? FOR UPDATE`,[flashId]);
  if(!offer||offer.status!=='ACTIVE')return 0;
  let recorded=0;
  const thresholds=[900,3600,86400];
  const rem=Number(offer.seconds_remaining),win=Number(offer.window_seconds);
  const threshold=rem>0?thresholds.find(t=>rem<=t&&win>t):null;
  if(threshold){
    const [buyers]=await conn.query("SELECT DISTINCT buyer_id FROM flash_purchase_holds WHERE flash_pool_id=? AND status IN ('HELD','PAYMENT_PENDING','PAID')",[flashId]);
    const recipients=[{userId:Number(offer.supplier_id),role:'SUPPLIER'},...buyers.map(r=>({userId:Number(r.buyer_id),role:'BUYER'}))];
    recorded+=await recordFlashReminder(conn,{flashId,kind:'POOL',commitmentId:flashId,
      deadlineUtc:offer.deadline_utc,threshold,recipients,type:'UCP.POOL_CLOSING'});
  }
  const [holds]=await conn.query(
    `SELECT id,buyer_id,DATE_FORMAT(expires_at,'%Y-%m-%dT%H:%i:%s.%f') AS deadline_utc,
       TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),expires_at) AS seconds_remaining,
       TIMESTAMPDIFF(SECOND,created_at,expires_at) AS window_seconds
     FROM flash_purchase_holds WHERE flash_pool_id=? AND status IN ('HELD','PAYMENT_PENDING') AND expires_at>UTC_TIMESTAMP() FOR UPDATE`,[flashId]);
  for(const hold of holds){
    const hRem=Number(hold.seconds_remaining),hWin=Number(hold.window_seconds);
    const hThreshold=hRem>0?[900,3600].find(t=>hRem<=t&&hWin>t):null;
    if(hThreshold){
      recorded+=await recordFlashReminder(conn,{flashId,kind:'HOLD',commitmentId:hold.id,
        deadlineUtc:hold.deadline_utc,threshold:hThreshold,
        recipients:[{userId:Number(hold.buyer_id),role:'BUYER'}],type:'UCP.HOLD_EXPIRING'});
    }
  }
  return recorded;
}

// Coordinates the existing Flash inventory/state engine; never edits money or
// stock directly. Connection-scoped MySQL lease is released on worker crash.
async function runFlashRecoveryBatch({database,flashService,limit=50}={}){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('INVALID_RECOVERY_LIMIT');
  const db=database||require('../config/db');
  const flash=flashService||require('./flashPoolService');
  const conn=await db.getConnection();
  let acquired=false,lease;
  const totals={processed:0,failed:0,skipped:false,reminders:0};
  try{
    const [[target]]=await conn.query('SELECT DATABASE() AS name');
    lease='ucp_flash_recovery:'+target.name;
    const [[lock]]=await conn.query('SELECT GET_LOCK(?,0) AS acquired',[lease]);
    if(lock.acquired!==1)return {...totals,skipped:true};
    acquired=true;
    const [cursors]=await conn.query("SELECT last_flash_id FROM ucp_recovery_cursors WHERE worker_name='flash_expiry'");
    const cursor=Number(cursors[0]?.last_flash_id)||0;
    const [offers]=await conn.query(
      `SELECT fp.id,fp.supplier_id,(fp.expiry_time<=UTC_TIMESTAMP()) AS expired,
         (fp.status='ACTIVE' AND fp.expiry_time>UTC_TIMESTAMP() AND fp.expiry_time<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR)) AS closing_soon
       FROM flash_pools fp WHERE fp.status IN ('ACTIVE','SOLD_OUT') AND
       (fp.expiry_time<=UTC_TIMESTAMP()
        OR (fp.status='ACTIVE' AND fp.expiry_time<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR))
        OR EXISTS (
         SELECT 1 FROM flash_purchase_holds h WHERE h.flash_pool_id=fp.id
         AND h.status IN ('HELD','PAYMENT_PENDING') AND h.expires_at<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR)))
       ORDER BY (fp.id<=?) ASC,fp.id ASC LIMIT ?`,[cursor,limit]);
    for(const offer of offers){
      try{
        if(Number(offer.expired)===1)await flash.expireOfferForRecovery(offer.id);
        else{
          await flash.reclaimExpiredUninitiatedHolds(offer.id);
          if(typeof conn.beginTransaction==='function'){
            await conn.beginTransaction();
            try{
              totals.reminders+=await recordFlashTimerReminders(conn,offer.id);
              await conn.commit();
            }catch(remErr){await conn.rollback();throw remErr;}
          }
        }
        totals.processed++;
      }catch(error){
        totals.failed++;
        // No request body, email, payment token or provider error in worker logs.
        console.error('[UCP recovery] Flash transition requires review',{flashId:offer.id,code:'RECOVERY_TRANSITION_FAILED'});
      }
    }
    if(offers.length)await conn.query(
      `INSERT INTO ucp_recovery_cursors(worker_name,last_flash_id) VALUES ('flash_expiry',?)
       ON DUPLICATE KEY UPDATE last_flash_id=VALUES(last_flash_id)`,[offers[offers.length-1].id]);
    return totals;
  }finally{
    try{if(acquired)await conn.query('SELECT RELEASE_LOCK(?)',[lease]);}
    finally{conn.release();}
  }
}
module.exports={runFlashRecoveryBatch,recordFlashTimerReminders};
