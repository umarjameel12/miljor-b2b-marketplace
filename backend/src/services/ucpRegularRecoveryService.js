'use strict';
const crypto=require('node:crypto');
const fail=(code,statusCode=409)=>Object.assign(new Error(code),{code,statusCode});
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const id=value=>{if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw fail('INVALID_RECOVERY_ID',400);return Number(value);};
const bounded=(value,max=100)=>{if(!Number.isInteger(value)||value<1||value>max)throw fail('INVALID_RECOVERY_LIMIT',400);return value;};
const admin=actor=>{if(!actor||!['ADMIN','SUPER_ADMIN'].includes(actor.role))throw fail('FORBIDDEN',403);id(actor.id);};

class UcpRegularRecoveryService {
  constructor({database,lifecycle,holds,notifications,eventService}={}){Object.assign(this,{database,lifecycle,holds,notifications,eventService});}
  get db(){return this.database||require('../config/db');}
  get commercial(){return this.lifecycle||require('./commercialLifecycleService').CommercialLifecycleService;}
  get paymentHolds(){return this.holds||require('./regularPoolPaymentHoldService');}
  get notices(){return this.notifications||require('./ucpTransactionalNotifications');}

  async lockedPool(conn,poolId){
    const [[pool]]=await conn.query('SELECT * FROM pools WHERE id=? FOR UPDATE',[id(poolId)]);
    if(!pool)throw fail('POOL_NOT_FOUND',404);
    if(!pool.product_spec_id||!pool.supplier_listing_id)throw fail('LEGACY_POOL_READ_ONLY',422);
    return pool;
  }
  async transaction(work){
    const conn=await this.db.getConnection();
    try{await conn.beginTransaction();const result=await work(conn);await conn.commit();return result;}
    catch(error){await conn.rollback();throw error;}finally{conn.release();}
  }
  async completeResponse(conn,{actor,idempotencyKey,poolId,result}){
    // The shared HTTP guard creates this record before invoking us. Completing
    // it here closes the crash-after-commit/before-res.json gap atomically with
    // the domain audit. Direct internal callers need no HTTP record.
    await conn.query(`UPDATE idempotency_records SET status='COMPLETED',response_status=200,response_body=?,
      resource_type='ucp_regular_recovery',resource_id=?,last_heartbeat_at=NOW()
      WHERE idempotency_key=? AND user_id=? AND status IN ('PENDING','UNKNOWN')`,
      [JSON.stringify({success:true,data:result}),poolId,idempotencyKey,actor.id]);
    return result;
  }
  async recoverOnConnection(conn,pool){
    let qualification=null;
    if(['ACTIVE','TARGET_REACHED'].includes(pool.status)){
      const [[clock]]=await conn.query('SELECT (expires_at<=NOW()) AS expired FROM pools WHERE id=?',[pool.id]);
      if(Number(clock.expired))qualification=await this.commercial.qualifyPoolParticipation({poolId:pool.id,
        actor:{id:0,role:'SYSTEM'},idempotencyKey:`regular-recovery-qualify-${pool.id}`,options:{connection:conn,isInternalReplay:true}});
    }
    const holds=await this.paymentHolds.expireForPoolOnConnection(conn,pool.id,{limit:100});
    const deadlines=await this.commercial.expireCommercialDeadlinesOnConnection(conn,pool.id,
      {limit:100,notifications:this.notices,eventService:this.eventService});
    const sla=await this.recordSlaBreach(conn,pool);
    const reminders=await this.recordTimerReminders(conn,pool.id);
    return {pool_id:Number(pool.id),qualification,holds,deadlines,sla,reminders};
  }
  async recoverPool(poolId){return this.transaction(async conn=>this.recoverOnConnection(conn,await this.lockedPool(conn,poolId)));}

  async recordTimerReminder(conn,{poolId,kind,commitmentId,version,deadlineKey,deadlineUtc,threshold,recipient,type,payload}){
    const reminderKey=hash([kind,commitmentId,version,deadlineKey,deadlineUtc,threshold]);
    const [existing]=await conn.query(`SELECT id FROM system_audit_logs WHERE entity_name='pools' AND entity_id=?
      AND action='REGULAR_TIMER_REMINDER' AND JSON_UNQUOTE(JSON_EXTRACT(new_value,'$.reminder_key'))=? LIMIT 1`,[poolId,reminderKey]);
    if(existing.length)return 0;
    await conn.query(`INSERT INTO system_audit_logs(actor_id,actor_role,action,entity_name,entity_id,new_value)
      VALUES (NULL,'SYSTEM','REGULAR_TIMER_REMINDER','pools',?,?)`,[poolId,JSON.stringify({reminder_key:reminderKey,
        kind,commitment_id:Number(commitmentId),version,deadline_key:deadlineKey,deadline_utc:deadlineUtc,threshold_seconds:threshold})]);
    await this.notices.recordInAppOnConnection(conn,{type,aggregateId:`regular-${kind}-${commitmentId}`,aggregateVersion:version,
      transitionId:reminderKey,recipients:[recipient],title:'Regular pool deadline approaching',
      message:'A deadline for your pool commitment is approaching. Open MilJor to review the current deadline and available action.',
      payload:{pool_id:Number(poolId),mode:'REGULAR',notification_path:'/pools',...payload}});
    return 1;
  }

  // Same parent lock, transaction, advisory worker lease and fair cursor as
  // expiry. No second timer engine and no request/device clock is consulted.
  async recordTimerReminders(conn,poolId){
    const pool=await this.lockedPool(conn,poolId);let recorded=0;
    const thresholds=[900,3600,86400];
    let kind,deadline,start,version=0,snapshot=null,revision=null;
    if(['ACTIVE','TARGET_REACHED'].includes(pool.status)){
      kind='PARTICIPATION';deadline=pool.expires_at;start=pool.participation_opens_at||pool.published_at||pool.created_at;
      revision=hash(pool.published_terms_snapshot||{published_at:pool.published_at||pool.created_at});
    }else if(['AWAITING_SUPPLIER_CONFIRMATION','CONFIRMED'].includes(pool.status)){
      [[snapshot]]=await conn.query(`SELECT * FROM pool_commercial_snapshots WHERE pool_id=?
        ORDER BY snapshot_version DESC,id DESC LIMIT 1 FOR UPDATE`,[poolId]);
      if(snapshot&&Number(snapshot.supplier_id)===Number(pool.supplier_id)){
        const [decisions]=await conn.query('SELECT id,decision,decision_timestamp FROM pool_supplier_commercial_decisions WHERE snapshot_id=? FOR UPDATE',[snapshot.id]);
        version=Number(snapshot.snapshot_version);revision=snapshot.id;
        if(pool.status==='AWAITING_SUPPLIER_CONFIRMATION'&&snapshot.status==='PENDING_SUPPLIER_DECISION'&&!decisions.length){
          kind='SUPPLIER_CONFIRMATION';deadline=snapshot.supplier_confirmation_deadline||pool.supplier_confirmation_deadline;start=snapshot.qualification_timestamp;
        }else if(pool.status==='CONFIRMED'&&snapshot.status==='ACCEPTED'&&decisions.length===1&&decisions[0].decision==='ACCEPT'){
          kind='BUYER_COMMITMENT';deadline=snapshot.buyer_commitment_deadline||pool.buyer_commitment_deadline;
          start=decisions[0].decision_timestamp||pool.confirmed_at;
        }
      }
    }
    if(kind&&deadline&&start&&Number.isSafeInteger(version)&&version>=0){
      const clock=async()=>{
        const [[row]]=await conn.query(`SELECT DATE_FORMAT(?,'%Y-%m-%dT%H:%i:%s.%f') AS deadline_utc,
          TIMESTAMPDIFF(SECOND,NOW(),?) AS seconds_remaining,TIMESTAMPDIFF(SECOND,?,?) AS window_seconds`,[deadline,deadline,start,deadline]);
        return row;
      };
      const initial=await clock();
      const threshold=Number(initial.seconds_remaining)>0?thresholds.find(t=>Number(initial.seconds_remaining)<=t):null;
      // Short windows do not manufacture already-passed 24h or 1h milestones.
      if(threshold&&Number(initial.window_seconds)>=threshold){
        const deadlineKey=hash([kind,poolId,revision,version,initial.deadline_utc]);
        const send=(commitmentKind,commitmentId,buyerId,payload={})=>this.recordTimerReminder(conn,{poolId,kind:commitmentKind,
          commitmentId,version,deadlineKey,deadlineUtc:initial.deadline_utc,threshold,
          recipient:{userId:Number(buyerId),role:commitmentKind==='PARTICIPATION_POOL'||commitmentKind==='SUPPLIER_CONFIRMATION'?'SUPPLIER':'BUYER'},
          type:kind==='PARTICIPATION'?'UCP.POOL_CLOSING':'UCP.CONFIRMATION_REQUIRED',payload});
        if(kind==='SUPPLIER_CONFIRMATION')recorded+=await send(kind,poolId,pool.supplier_id);
        else{
          let cohort=[];
          if(kind==='BUYER_COMMITMENT'){
            cohort=parse(snapshot.participating_reservations_summary);
            if(!Array.isArray(cohort)||cohort.some(r=>!Number.isSafeInteger(Number(r.id))||Number(r.id)<1))throw fail('RECOVERY_COHORT_REQUIRED',422);
          }
          const reservationKind=kind==='PARTICIPATION'?'PARTICIPATION_RESERVATION':kind;
          const [reservations]=kind==='BUYER_COMMITMENT'&&!cohort.length?[[]]:await conn.query(`SELECT r.id,r.buyer_id FROM reservations r
            WHERE r.pool_id=? AND r.status='RESERVED'
            ${kind==='BUYER_COMMITMENT'?`AND r.id IN (${cohort.map(()=>'?').join(',')})`:''}
            AND NOT EXISTS (SELECT 1 FROM pool_buyer_commercial_decisions d WHERE d.reservation_id=r.id)
            AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.reservation_id=r.id)
            AND NOT EXISTS (SELECT 1 FROM system_audit_logs a WHERE a.entity_name='pools' AND a.entity_id=r.pool_id
              AND a.action='REGULAR_TIMER_REMINDER' AND JSON_UNQUOTE(JSON_EXTRACT(a.new_value,'$.kind'))=?
              AND JSON_UNQUOTE(JSON_EXTRACT(a.new_value,'$.commitment_id'))=CAST(r.id AS CHAR)
              AND JSON_UNQUOTE(JSON_EXTRACT(a.new_value,'$.deadline_key'))=?
              AND JSON_UNQUOTE(JSON_EXTRACT(a.new_value,'$.threshold_seconds'))=?)
            ORDER BY r.id LIMIT 100 FOR UPDATE`,[poolId,...cohort.map(r=>r.id),reservationKind,deadlineKey,String(threshold)]);
          // Reservation locks can wait. Re-read the DB clock before emitting;
          // don't send a stale 1h reminder after expiry or crossing into 15m.
          const fresh=await clock();
          if(Number(fresh.seconds_remaining)>0&&thresholds.find(t=>Number(fresh.seconds_remaining)<=t)===threshold){
            if(kind==='PARTICIPATION')recorded+=await send('PARTICIPATION_POOL',poolId,pool.supplier_id);
            for(const r of reservations)recorded+=await send(reservationKind,r.id,r.buyer_id,{reservation_id:Number(r.id)});
          }
        }
      }
    }
    // Only HELD/unpaid/uninitiated windows have a checkout action available.
    // Regular payment holds have a fixed 15-minute lifetime; 24h/1h reminders
    // are inapplicable. Exclude recorded rows before LIMIT to avoid starvation.
    if(!['CONFIRMED','PAYMENT_PENDING'].includes(pool.status))return recorded;
    const [candidates]=await conn.query(`SELECT h.id,h.order_id FROM regular_pool_payment_holds h JOIN orders o ON o.id=h.order_id
      WHERE h.pool_id=? AND h.status='HELD' AND h.expires_at>UTC_TIMESTAMP()
      AND h.expires_at<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE)
      AND o.order_status='AWAITING_PAYMENT' AND o.payment_status='AWAITING_PAYMENT'
      AND NOT EXISTS (SELECT 1 FROM payment_attempts pa WHERE pa.order_id=h.order_id AND pa.status IN ('INITIATED','RECONCILIATION_REQUIRED'))
      AND NOT EXISTS (SELECT 1 FROM system_audit_logs a WHERE a.entity_name='pools' AND a.entity_id=h.pool_id
        AND a.action='REGULAR_TIMER_REMINDER' AND JSON_UNQUOTE(JSON_EXTRACT(a.new_value,'$.kind'))='PAYMENT_HOLD'
        AND JSON_UNQUOTE(JSON_EXTRACT(a.new_value,'$.commitment_id'))=CAST(h.id AS CHAR)
        AND JSON_UNQUOTE(JSON_EXTRACT(a.new_value,'$.deadline_utc'))=DATE_FORMAT(h.expires_at,'%Y-%m-%dT%H:%i:%s.%f'))
      ORDER BY h.id LIMIT 100`,[poolId]);
    for(const candidate of candidates){
      const [[order]]=await conn.query('SELECT id,pool_id,buyer_id,reservation_id,payment_status,order_status FROM orders WHERE id=? FOR UPDATE',[candidate.order_id]);
      const [[hold]]=await conn.query('SELECT * FROM regular_pool_payment_holds WHERE id=? FOR UPDATE',[candidate.id]);
      if(!hold||hold.status!=='HELD'||!order||order.order_status!=='AWAITING_PAYMENT'||order.payment_status!=='AWAITING_PAYMENT')continue;
      if(Number(hold.pool_id)!==Number(poolId)||Number(order.pool_id)!==Number(poolId)||Number(order.buyer_id)!==Number(hold.buyer_id)||Number(order.reservation_id)!==Number(hold.reservation_id))throw fail('REGULAR_HOLD_OWNERSHIP_MISMATCH');
      const [attempts]=await conn.query("SELECT id FROM payment_attempts WHERE order_id=? AND status IN ('INITIATED','RECONCILIATION_REQUIRED') LIMIT 1 FOR UPDATE",[order.id]);
      const [[fresh]]=await conn.query(`SELECT DATE_FORMAT(expires_at,'%Y-%m-%dT%H:%i:%s.%f') AS deadline_utc,
        TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),expires_at) AS seconds_remaining FROM regular_pool_payment_holds WHERE id=?`,[hold.id]);
      if(attempts.length||Number(fresh.seconds_remaining)<=0||Number(fresh.seconds_remaining)>900)continue;
      recorded+=await this.recordTimerReminder(conn,{poolId,kind:'PAYMENT_HOLD',commitmentId:hold.id,version:1,
        deadlineKey:hash(['PAYMENT_HOLD',hold.id,1,fresh.deadline_utc]),deadlineUtc:fresh.deadline_utc,threshold:900,
        recipient:{userId:Number(hold.buyer_id),role:'BUYER'},type:'UCP.HOLD_EXPIRING',payload:{order_id:Number(order.id),reservation_id:Number(hold.reservation_id)}});
    }
    return recorded;
  }

  async notifyPool(conn,pool,type,transitionId,{buyerId=null,admins=false}={}){
    const [users]=await conn.query(`SELECT DISTINCT u.id,u.role FROM users u WHERE u.id=?
      OR (? IS NOT NULL AND u.id=?) OR (?=1 AND u.role IN ('ADMIN','SUPER_ADMIN'))
      OR (? IS NULL AND EXISTS (SELECT 1 FROM reservations r WHERE r.pool_id=? AND r.buyer_id=u.id
        AND r.status IN ('RESERVED','CONFIRMED','PAID')))`,[pool.supplier_id,buyerId,buyerId,admins?1:0,buyerId,pool.id]);
    for(const user of users){
      const expected=Number(user.id)===Number(pool.supplier_id)?'SUPPLIER':
        admins&&['ADMIN','SUPER_ADMIN'].includes(user.role)?user.role:'BUYER';
      if(user.role!==expected)throw fail('NOTIFICATION_RECIPIENT_ROLE_MISMATCH');
    }
    for(let offset=0;offset<users.length;offset+=100)await this.notices.recordInAppOnConnection(conn,{
      type,aggregateId:'pool-'+pool.id,aggregateVersion:1,transitionId,
      recipients:users.slice(offset,offset+100).map(u=>({userId:Number(u.id),role:u.role})),
      title:'Regular pool recovery update',message:'A recovery update was recorded. Review your pool in MilJor. Existing terms and funds remain subject to authorized recovery.',
      payload:{pool_id:Number(pool.id),mode:'REGULAR',notification_path:'/pools'}});
  }
  async recordSlaBreach(conn,pool){
    // Delivery SLA breach escalates for support; it is not proof of supplier
    // delivery, receipt, cancellation, refund, or settlement.
    const [[fresh]]=await conn.query(`SELECT status,(promised_delivery_at<=NOW()) AS breached FROM pools WHERE id=?`,[pool.id]);
    if(!['CONFIRMED','PAYMENT_PENDING','FULFILLING','DISPATCHED'].includes(fresh.status)||!Number(fresh.breached))return false;
    const [existing]=await conn.query("SELECT id FROM system_audit_logs WHERE entity_name='pools' AND entity_id=? AND action='REGULAR_DELIVERY_SLA_BREACHED' LIMIT 1",[pool.id]);
    if(existing.length)return false;
    const transitionId='regular-delivery-sla-'+pool.id;
    await conn.query(`INSERT INTO system_audit_logs(actor_id,actor_role,action,entity_name,entity_id,new_value)
      VALUES (NULL,'SYSTEM','REGULAR_DELIVERY_SLA_BREACHED','pools',?,?)`,[pool.id,JSON.stringify({transition_id:transitionId,status:'REVIEW_REQUIRED'})]);
    await this.notifyPool(conn,pool,'FULFILLMENT.SLA_BREACHED',transitionId,{admins:true});
    return true;
  }

  // Connection-scoped lease disappears on worker death. Durable fair rotation
  // shares existing cursor metadata: last_flash_id holds a pool ID ONLY for
  // this distinct worker_name; Flash's row and cursor semantics are unchanged.
  async runBatch({limit=50}={}){
    bounded(limit);
    const conn=await this.db.getConnection();let acquired=false,lease;
    const totals={processed:0,failed:0,skipped:false,errors:[]};
    try{
      const [[target]]=await conn.query('SELECT DATABASE() AS name');
      lease='ucp_regular:'+hash(target.name).slice(0,40);
      const [[lock]]=await conn.query('SELECT GET_LOCK(?,0) AS acquired',[lease]);
      if(Number(lock.acquired)!==1)return {...totals,skipped:true};
      acquired=true;
      const [[cursor]]=await conn.query("SELECT last_flash_id FROM ucp_recovery_cursors WHERE worker_name='regular_expiry'");
      const [pools]=await conn.query(`SELECT p.id FROM pools p LEFT JOIN pool_commercial_snapshots s
        ON s.id=(SELECT sx.id FROM pool_commercial_snapshots sx WHERE sx.pool_id=p.id ORDER BY sx.snapshot_version DESC,sx.id DESC LIMIT 1) WHERE
        (p.status IN ('ACTIVE','TARGET_REACHED') AND p.expires_at<=NOW())
        OR (p.status='AWAITING_SUPPLIER_CONFIRMATION' AND COALESCE(s.supplier_confirmation_deadline,p.supplier_confirmation_deadline)<=NOW())
        OR (p.status='CONFIRMED' AND COALESCE(s.buyer_commitment_deadline,p.buyer_commitment_deadline)<=NOW() AND EXISTS
          (SELECT 1 FROM reservations r WHERE r.pool_id=p.id AND r.status='RESERVED'
           AND NOT EXISTS (SELECT 1 FROM pool_buyer_commercial_decisions d WHERE d.reservation_id=r.id)
           AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.reservation_id=r.id)))
        OR EXISTS (SELECT 1 FROM regular_pool_payment_holds h WHERE h.pool_id=p.id
          AND h.status IN ('HELD','PAYMENT_PENDING') AND h.expires_at<=UTC_TIMESTAMP())
        OR (p.status IN ('ACTIVE','TARGET_REACHED') AND p.expires_at>NOW() AND p.expires_at<=DATE_ADD(NOW(),INTERVAL 24 HOUR))
        OR (p.status='AWAITING_SUPPLIER_CONFIRMATION' AND COALESCE(s.supplier_confirmation_deadline,p.supplier_confirmation_deadline)>NOW()
          AND COALESCE(s.supplier_confirmation_deadline,p.supplier_confirmation_deadline)<=DATE_ADD(NOW(),INTERVAL 24 HOUR))
        OR (p.status='CONFIRMED' AND COALESCE(s.buyer_commitment_deadline,p.buyer_commitment_deadline)>NOW()
          AND COALESCE(s.buyer_commitment_deadline,p.buyer_commitment_deadline)<=DATE_ADD(NOW(),INTERVAL 24 HOUR))
        OR (p.status IN ('CONFIRMED','PAYMENT_PENDING') AND EXISTS (SELECT 1 FROM regular_pool_payment_holds h JOIN orders o ON o.id=h.order_id WHERE h.pool_id=p.id
          AND h.status='HELD' AND h.expires_at>UTC_TIMESTAMP() AND h.expires_at<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE)
          AND o.order_status='AWAITING_PAYMENT' AND o.payment_status='AWAITING_PAYMENT'
          AND NOT EXISTS (SELECT 1 FROM payment_attempts pa WHERE pa.order_id=h.order_id AND pa.status IN ('INITIATED','RECONCILIATION_REQUIRED'))))
        OR (p.status IN ('CONFIRMED','PAYMENT_PENDING','FULFILLING','DISPATCHED') AND p.promised_delivery_at<=NOW()
          AND NOT EXISTS (SELECT 1 FROM system_audit_logs a WHERE a.entity_name='pools' AND a.entity_id=p.id AND a.action='REGULAR_DELIVERY_SLA_BREACHED'))
        ORDER BY (p.id<=?) ASC,p.id ASC LIMIT ?`,[Number(cursor?.last_flash_id)||0,limit]);
      for(const pool of pools){
        try{await this.recoverPool(pool.id);totals.processed++;}
        catch(error){totals.failed++;totals.errors.push({pool_id:Number(pool.id),code:typeof error.code==='string'?error.code:'REGULAR_RECOVERY_FAILED'});}
      }
      if(pools.length)await conn.query(`INSERT INTO ucp_recovery_cursors(worker_name,last_flash_id)
        VALUES ('regular_expiry',?) ON DUPLICATE KEY UPDATE last_flash_id=VALUES(last_flash_id)`,[pools[pools.length-1].id]);
      return totals;
    }finally{try{if(acquired)await conn.query('SELECT RELEASE_LOCK(?)',[lease]);}finally{conn.release();}}
  }

  async listExceptions({actor,afterId=0,limit=50}={}){
    admin(actor);bounded(limit);
    if(!Number.isSafeInteger(afterId)||afterId<0)throw fail('INVALID_RECOVERY_CURSOR',400);
    const [rows]=await this.db.query(`SELECT p.id AS pool_id,p.supplier_id,p.status,p.expires_at,
      p.supplier_confirmation_deadline,p.buyer_commitment_deadline,p.promised_delivery_at,
      (SELECT COUNT(*) FROM regular_pool_payment_holds h WHERE h.pool_id=p.id AND h.status='RECONCILIATION_REQUIRED') AS reconciliation_count
      ,(SELECT COUNT(*) FROM payment_attempts pa JOIN orders o ON o.id=pa.order_id
        WHERE o.pool_id=p.id AND pa.status IN ('INITIATED','RECONCILIATION_REQUIRED')) AS unresolved_attempt_count
      FROM pools p WHERE p.id>? AND (p.status='SUPPLIER_FAILED'
        OR EXISTS (SELECT 1 FROM payment_attempts pa JOIN orders o ON o.id=pa.order_id
          WHERE o.pool_id=p.id AND pa.status='RECONCILIATION_REQUIRED')
        OR EXISTS (SELECT 1 FROM regular_pool_payment_holds h WHERE h.pool_id=p.id AND h.status IN ('EXPIRED','RECONCILIATION_REQUIRED'))
        OR (p.status IN ('ACTIVE','TARGET_REACHED') AND p.expires_at<=NOW())
        OR (p.status='AWAITING_SUPPLIER_CONFIRMATION' AND (p.supplier_confirmation_deadline IS NULL OR p.supplier_confirmation_deadline<=NOW()))
        OR (p.status='CONFIRMED' AND (p.buyer_commitment_deadline IS NULL OR p.buyer_commitment_deadline<=NOW()))
        OR (p.status IN ('CONFIRMED','PAYMENT_PENDING','FULFILLING','DISPATCHED') AND p.promised_delivery_at<=NOW()))
      ORDER BY p.id LIMIT ?`,[afterId,limit]);
    return {items:rows,next_cursor:rows.length?Number(rows[rows.length-1].pool_id):afterId};
  }

  async getPoolRecovery({actor,poolId}){
    id(actor?.id);id(poolId);
    if(!['BUYER','SUPPLIER','ADMIN','SUPER_ADMIN'].includes(actor.role))throw fail('FORBIDDEN',403);
    const [[pool]]=await this.db.query('SELECT id,supplier_id,status,supplier_confirmation_deadline,buyer_commitment_deadline,promised_delivery_at FROM pools WHERE id=?',[poolId]);
    if(!pool)throw fail('POOL_NOT_FOUND',404);
    if(actor.role==='SUPPLIER'&&Number(pool.supplier_id)!==Number(actor.id))throw fail('FORBIDDEN',403);
    if(actor.role==='BUYER'){
      const [own]=await this.db.query('SELECT id FROM reservations WHERE pool_id=? AND buyer_id=? LIMIT 1',[poolId,actor.id]);
      if(!own.length)throw fail('FORBIDDEN',403);
    }
    // No peer reservations, addresses, payment attempts, or internal audit notes.
    if(actor.role==='BUYER'){
      const [proposals]=await this.db.query(`SELECT new_value FROM system_audit_logs WHERE entity_name='pools' AND entity_id=?
        AND action='REGULAR_ADMIN_RECOVERY' AND JSON_UNQUOTE(JSON_EXTRACT(new_value,'$.result.buyer_id'))=? ORDER BY id DESC LIMIT 50`,[poolId,String(actor.id)]);
      return {...pool,replacement_proposals:proposals.map(row=>{
        const p=parse(row.new_value).result;
        return {proposal_id:p.proposal_id,reservation_id:p.reservation_id,replacement_supplier_id:p.replacement_supplier_id,status:p.status};
      })};
    }
    return pool;
  }

  async recover({actor,poolId,idempotencyKey,input}){
    admin(actor);id(poolId);
    if(typeof idempotencyKey!=='string'||!idempotencyKey.trim()||idempotencyKey.length>100)throw fail('MISSING_IDEMPOTENCY_KEY',400);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['action','reason','reservation_id','replacement_supplier_id'].includes(k)))throw fail('INVALID_RECOVERY_INPUT',400);
    if(!['RETRY_TIMERS','ACKNOWLEDGE_EXCEPTION','PROPOSE_REPLACEMENT'].includes(input.action))throw fail('UNSUPPORTED_RECOVERY_ACTION',422);
    if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500)throw fail('RECOVERY_REASON_REQUIRED',400);
    if(input.action!=='PROPOSE_REPLACEMENT'&&(input.reservation_id!==undefined||input.replacement_supplier_id!==undefined))throw fail('INVALID_RECOVERY_INPUT',400);
    const requestHash=hash(input),key=hash([actor.id,idempotencyKey.trim()]);
    return this.transaction(async conn=>{
      const pool=await this.lockedPool(conn,poolId);
      const [previous]=await conn.query(`SELECT new_value FROM system_audit_logs WHERE entity_name='pools'
        AND entity_id=? AND action='REGULAR_ADMIN_RECOVERY' AND JSON_UNQUOTE(JSON_EXTRACT(new_value,'$.request_key'))=? LIMIT 1`,[poolId,key]);
      if(previous.length){const saved=parse(previous[0].new_value);if(saved.request_hash!==requestHash)throw fail('IDEMPOTENCY_CONFLICT');return this.completeResponse(conn,{actor,idempotencyKey,poolId,result:saved.result});}
      let result;
      if(input.action==='RETRY_TIMERS')result=await this.recoverOnConnection(conn,pool);
      else if(input.action==='ACKNOWLEDGE_EXCEPTION')result={pool_id:Number(poolId),status:'REVIEW_ACKNOWLEDGED'};
      else{
        if(pool.status!=='SUPPLIER_FAILED')throw fail('SUPPLIER_FAILURE_REQUIRED',422);
        const reservationId=id(input.reservation_id),supplierId=id(input.replacement_supplier_id);
        if(supplierId===Number(pool.supplier_id))throw fail('REPLACEMENT_SUPPLIER_REQUIRED',400);
        const [[reservation]]=await conn.query("SELECT id,buyer_id FROM reservations WHERE id=? AND pool_id=? AND status IN ('RESERVED','CONFIRMED','PAID') FOR UPDATE",[reservationId,poolId]);
        if(!reservation)throw fail('RECOVERY_RESERVATION_NOT_FOUND',404);
        const [[candidate]]=await conn.query(`SELECT u.role,u.is_verified,u.verification_status,
          s.verification_status AS supplier_profile_verification FROM users u
          LEFT JOIN supplier_profiles s ON s.supplier_id=u.id WHERE u.id=?`,[supplierId]);
        if(!require('./supplierEligibilityPolicy').evaluateSupplierEligibility(candidate).eligible)
          throw fail('REPLACEMENT_SUPPLIER_NOT_VERIFIED',422);
        const proposalId=hash([poolId,key,requestHash]);
        result={pool_id:Number(poolId),proposal_id:proposalId,reservation_id:reservationId,buyer_id:Number(reservation.buyer_id),
          replacement_supplier_id:supplierId,status:'BUYER_CONSENT_REQUIRED'};
        await this.notifyPool(conn,pool,'UCP.CONFIRMATION_REQUIRED',proposalId,{buyerId:reservation.buyer_id});
      }
      await conn.query(`INSERT INTO system_audit_logs
        (actor_id,actor_role,action,entity_name,entity_id,previous_value,new_value)
        VALUES (?,?,'REGULAR_ADMIN_RECOVERY','pools',?,?,?)`,[actor.id,actor.role,poolId,
        JSON.stringify({status:pool.status}),JSON.stringify({request_key:key,request_hash:requestHash,action:input.action,reason:input.reason.trim(),result})]);
      if(input.action!=='PROPOSE_REPLACEMENT')await this.notifyPool(conn,pool,'ADMIN.MANUAL_RECONCILIATION_RESULT',key,{admins:true});
      return this.completeResponse(conn,{actor,idempotencyKey,poolId,result});
    });
  }

  async consent({actor,poolId,proposalId,idempotencyKey,input}){
    if(actor?.role!=='BUYER')throw fail('FORBIDDEN',403);id(actor.id);id(poolId);
    if(typeof proposalId!=='string'||!/^[a-f0-9]{64}$/.test(proposalId))throw fail('INVALID_PROPOSAL',400);
    if(typeof idempotencyKey!=='string'||!idempotencyKey.trim()||idempotencyKey.length>100)throw fail('MISSING_IDEMPOTENCY_KEY',400);
    if(!input||Object.keys(input).length!==1||typeof input.consent!=='boolean')throw fail('EXPLICIT_BUYER_CONSENT_REQUIRED',400);
    return this.transaction(async conn=>{
      const pool=await this.lockedPool(conn,poolId);
      const [[proposal]]=await conn.query(`SELECT new_value FROM system_audit_logs WHERE entity_name='pools' AND entity_id=?
        AND action='REGULAR_ADMIN_RECOVERY' AND JSON_UNQUOTE(JSON_EXTRACT(new_value,'$.result.proposal_id'))=? LIMIT 1`,[poolId,proposalId]);
      if(!proposal)throw fail('RECOVERY_PROPOSAL_NOT_FOUND',404);
      const offered=parse(proposal.new_value).result;
      if(Number(offered.buyer_id)!==Number(actor.id))throw fail('FORBIDDEN',403);
      const [[reservation]]=await conn.query('SELECT buyer_id FROM reservations WHERE id=? AND pool_id=? FOR UPDATE',[offered.reservation_id,poolId]);
      if(!reservation||Number(reservation.buyer_id)!==Number(actor.id))throw fail('FORBIDDEN',403);
      const [previous]=await conn.query(`SELECT new_value FROM system_audit_logs WHERE entity_name='pools' AND entity_id=?
        AND action='REGULAR_REPLACEMENT_CONSENT' AND JSON_UNQUOTE(JSON_EXTRACT(new_value,'$.proposal_id'))=? LIMIT 1`,[poolId,proposalId]);
      if(previous.length){const saved=parse(previous[0].new_value);if(saved.consent!==input.consent||saved.request_key!==hash([actor.id,idempotencyKey.trim()]))throw fail('CONSENT_ALREADY_RECORDED');return this.completeResponse(conn,{actor,idempotencyKey,poolId,result:saved.result});}
      if(pool.status!=='SUPPLIER_FAILED')throw fail('SUPPLIER_FAILURE_REQUIRED',422);
      const result={pool_id:Number(poolId),proposal_id:proposalId,status:input.consent?'CONSENT_RECORDED_RECONTRACT_REQUIRED':'REPLACEMENT_DECLINED',replacement_executed:false};
      await conn.query(`INSERT INTO system_audit_logs(actor_id,actor_role,action,entity_name,entity_id,new_value)
        VALUES (?,?,'REGULAR_REPLACEMENT_CONSENT','pools',?,?)`,[actor.id,actor.role,poolId,JSON.stringify({proposal_id:proposalId,
          consent:input.consent,request_key:hash([actor.id,idempotencyKey.trim()]),result})]);
      await this.notifyPool(conn,pool,'ADMIN.MANUAL_RECONCILIATION_RESULT','consent-'+proposalId,{buyerId:actor.id,admins:true});
      return this.completeResponse(conn,{actor,idempotencyKey,poolId,result});
    });
  }
}
const service=new UcpRegularRecoveryService();
module.exports=service;
module.exports.UcpRegularRecoveryService=UcpRegularRecoveryService;
module.exports.runRegularRecoveryBatch=options=>{
  const {database,lifecycle,holds,notifications,eventService,...batch}=options||{};
  return new UcpRegularRecoveryService({database,lifecycle,holds,notifications,eventService}).runBatch(batch);
};
