'use strict';

// B6-L/M: buyer-owned recurring contract configuration and scheduled proposal
// generation. No order, inventory reservation, Safepay or automatic charging.
const crypto=require('node:crypto');
const db=require('../config/db');
const {normalizeSchedule,nextCycles}=require('./procurementSchedulePolicy');
const fail=(code,message,statusCode=400)=>Object.assign(new Error(message),{code,statusCode});
const id=(value,label)=>{
  if(value==null||typeof value==='boolean'||!/^[1-9]\d*$/.test(String(value))||
     !Number.isSafeInteger(Number(value)))
    throw fail('INVALID_RECURRING_ID',label+' must be a positive identifier.');
  return Number(value);
};
const idem=value=>{
  if(typeof value!=='string'||!/^[A-Za-z0-9:_-]{12,120}$/.test(value))
    throw fail('INVALID_IDEMPOTENCY_KEY','X-Idempotency-Key must be 12–120 safe characters.');
  return value;
};
const utc=value=>{
  if(value instanceof Date)return value.toISOString();
  if(typeof value==='string'){
    const ms=Date.parse(value.replace(' ','T')+'Z');
    if(Number.isFinite(ms))return new Date(ms).toISOString();
  }
  throw fail('INVALID_SERVER_CLOCK','Unable to determine authoritative UTC time.',500);
};

class ProcurementRecurringService {
  constructor(database=db){this.database=database;}
  async _verified(conn,buyer){
    const [rows]=await conn.query(
      `SELECT id FROM users WHERE id=? AND role='BUYER' AND is_verified=1
        AND verification_status='VERIFIED' AND buyer_trust_status<>'SUSPENDED'`,[buyer]);
    if(!rows.length)throw fail('BUYER_NOT_ELIGIBLE','Active verified B2B buyer required.',403);
  }
  async createDraft(buyerId,requestId,schedule,rawKey){
    const buyer=id(buyerId,'Buyer'),request=id(requestId,'Template'),key=idem(rawKey);
    const input=normalizeSchedule(schedule);
    const hash=crypto.createHash('sha256').update(JSON.stringify({request,input})).digest('hex');
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();
      await this._verified(conn,buyer);
      const [existing]=await conn.query(
        'SELECT id,request_hash,original_response_snapshot FROM procurement_recurring_contracts WHERE buyer_id=? AND created_idempotency_key=? FOR UPDATE',
        [buyer,key]);
      if(existing.length){
        if(existing[0].request_hash!==hash)
          throw fail('IDEMPOTENCY_CONFLICT','Contract key already used with different schedule.',409);
        const raw=existing[0].original_response_snapshot;
        const original=typeof raw==='string'?JSON.parse(raw):raw;
        await conn.commit();
        return {contract:original,is_replay:true};
      }
      const [templates]=await conn.query(
        `SELECT id,buyer_id,status,ownership,frequency FROM procurement_requests
         WHERE id=? AND buyer_id=? FOR UPDATE`,[request,buyer]);
      const template=templates[0];
      if(!template)throw fail('REQUEST_NOT_FOUND','Procurement template not found.',404);
      if(template.status!=='DRAFT'||template.ownership!=='SINGLE_BUYER'||
         template.frequency!==input.cadence)
        throw fail('RECURRING_TEMPLATE_INVALID','Use your own single-buyer weekly/monthly draft as a recurring template.',409);
      const [items]=await conn.query(
        'SELECT id FROM procurement_request_items WHERE request_id=?',[request]);
      if(!items.length)throw fail('RECURRING_ITEMS_REQUIRED','At least one requested item is required.');
      const contractCode='MJ-REC-'+crypto.randomUUID();
      const [created]=await conn.query(
        `INSERT INTO procurement_recurring_contracts
          (contract_code,buyer_id,template_request_id,cadence,weekday_number,
           month_day,month_end_policy,local_run_time,timezone_name,starts_on,
           ends_on,payment_policy,pricing_policy,status,created_idempotency_key,request_hash)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?,?)`,
        [contractCode,buyer,request,input.cadence,input.weekday_number,input.month_day,
         input.month_end_policy,input.local_run_time,input.timezone_name,
         input.starts_on,input.ends_on,input.payment_policy,input.pricing_policy,key,hash]
      );
      const [saved]=await conn.query(
        'SELECT * FROM procurement_recurring_contracts WHERE id=?',[created.insertId]);
      const original=saved[0];
      await conn.query(
        'UPDATE procurement_recurring_contracts SET original_response_snapshot=? WHERE id=?',
        [JSON.stringify(original),created.insertId]
      );
      await conn.commit();
      return {contract:original,is_replay:false};
    }catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')
      throw fail('RECURRING_CONFLICT','Contract already exists, refresh before retrying.',409);
      throw e;
    }finally{conn.release();}
  }
  async changeStatus(buyerId,contractId,action,expectedVersion,consent){
    const buyer=id(buyerId,'Buyer'),cid=id(contractId,'Contract');
    const transitions={ACTIVATE:['DRAFT','ACTIVE'],
      PAUSE:['ACTIVE','PAUSED'],RESUME:['PAUSED','ACTIVE'],
      CANCEL:['DRAFT','ACTIVE','PAUSED','CANCELLED']};
    if(!transitions[action])throw fail('INVALID_RECURRING_ACTION','Unknown contract action.');
    const version=id(expectedVersion,'Current contract version');
    if(action==='ACTIVATE'&&consent!==true)
      throw fail('EXPLICIT_RECURRING_CONSENT_REQUIRED','Buyer must explicitly activate this schedule.');
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();
      await this._verified(conn,buyer);
      const [rows]=await conn.query(
        'SELECT * FROM procurement_recurring_contracts WHERE id=? AND buyer_id=? FOR UPDATE',
        [cid,buyer]);
      const contract=rows[0];
      if(!contract)throw fail('CONTRACT_NOT_FOUND','Recurring contract not found.',404);
      const target={ACTIVATE:'ACTIVE',PAUSE:'PAUSED',RESUME:'ACTIVE',CANCEL:'CANCELLED'}[action];
      if(contract.status===target&&Number(contract.version_number)===version+1){
        await conn.commit();
        return {...contract,is_replay:true};
      }
      if(Number(contract.version_number)!==version)
        throw fail('RECURRING_VERSION_CONFLICT','Schedule changed. Refresh before retrying.',409);
      const expected=transitions[action][0];
      if(contract.status!==expected)
        throw fail('RECURRING_STATE_CONFLICT','This schedule cannot perform the requested action.',409);
      const [updated]=await conn.query(
        `UPDATE procurement_recurring_contracts
         SET status=?,version_number=version_number+1,
         activated_at=CASE WHEN ?='ACTIVATE' THEN UTC_TIMESTAMP() ELSE activated_at END
         WHERE id=? AND buyer_id=? AND status=? AND version_number=?`,
        [target,action,cid,buyer,expected,version]
      );
      if(updated.affectedRows!==1)throw fail('RECURRING_RACE','Contract was concurrently modified.',409);
      const [saved]=await conn.query(
        'SELECT * FROM procurement_recurring_contracts WHERE id=?',[cid]);
      await conn.commit();
      return {...saved[0],is_replay:false};
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }
  async listMine(buyerId){
    const buyer=id(buyerId,'Buyer');
    const [rows]=await this.database.query(
      `SELECT id,contract_code,template_request_id,cadence,weekday_number,
        month_day,month_end_policy,local_run_time,timezone_name,starts_on,
        ends_on,payment_policy,pricing_policy,status,version_number,created_at
        FROM procurement_recurring_contracts WHERE buyer_id=?
        ORDER BY id DESC LIMIT 100`,[buyer]);
    return rows;
  }
  async prepareUpcoming(contractId,{limit=6}={}){
    const cid=id(contractId,'Contract');
    if(!Number.isInteger(limit)||limit<1||limit>24)
      throw fail('INVALID_CYCLE_LIMIT','Choose 1–24 cycles.');
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();
      const [contracts]=await conn.query(
        'SELECT * FROM procurement_recurring_contracts WHERE id=? FOR UPDATE',[cid]);
      const contract=contracts[0];
      if(!contract)throw fail('CONTRACT_NOT_FOUND','Recurring contract not found.',404);
      if(contract.status!=='ACTIVE'||!contract.activated_at)
        throw fail('CONTRACT_NOT_ACTIVE','Only explicitly activated schedules produce cycles.',409);
      const [[clock]]=await conn.query('SELECT UTC_TIMESTAMP() AS utc_now');
      const now=utc(clock.utc_now);
      const activation=utc(contract.activated_at);
      const origin=activation>now?activation:now;
      const date=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
      const input={
        cadence:contract.cadence,weekday_number:contract.weekday_number,
        month_day:contract.month_day,month_end_policy:contract.month_end_policy,
        local_run_time:String(contract.local_run_time).slice(0,5),
        timezone_name:contract.timezone_name,
        starts_on:date(contract.starts_on),
        ends_on:contract.ends_on?date(contract.ends_on):null,
        pricing_policy:contract.pricing_policy,payment_policy:contract.payment_policy
      };
      const cycles=nextCycles(input,{from:origin,limit});
      const emitted=[];
      for(const cycle of cycles){
        const [result]=await conn.query(
          `INSERT INTO procurement_recurring_cycles
            (contract_id,buyer_id,cycle_key,due_at_utc,status,contract_version,contract_snapshot)
          VALUES (?,?,?,?,'SCHEDULED',?,?)
          ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
          [cid,contract.buyer_id,cycle.cycle_key,
           cycle.due_at_utc.slice(0,19).replace('T',' '),
           contract.version_number,JSON.stringify({template_request_id:contract.template_request_id,
            ...input,payment_authorized:false})]
        );
        await conn.query(
          `INSERT INTO procurement_recurring_cycle_events
           (cycle_id,event_key,event_type,event_snapshot)
           VALUES (?,'CYCLE_SCHEDULED','CYCLE_SCHEDULED',?)
           ON DUPLICATE KEY UPDATE id=id`,
          [result.insertId,JSON.stringify({cycle_key:cycle.cycle_key,
            due_at_utc:cycle.due_at_utc,payment_authorized:false})]
        );
        emitted.push({cycle_id:result.insertId,...cycle});
      }
      await conn.commit();
      return {contract_id:cid,cycles:emitted,created_payments:0,
        generated_orders:0,requires_buyer_approval:true};
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }
}
module.exports=new ProcurementRecurringService();
module.exports.ProcurementRecurringService=ProcurementRecurringService;
