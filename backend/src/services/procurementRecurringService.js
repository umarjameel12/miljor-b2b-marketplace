'use strict';

// B6-L/M: buyer-owned recurring contract configuration and scheduled proposal
// generation. No order, inventory reservation, Safepay or automatic charging.
const crypto=require('node:crypto');
const db=require('../config/db');
const {normalizeSchedule,nextCycles}=require('./procurementSchedulePolicy');
const notifications=require('./notificationService');
const requestService=require('./procurementRequestService');
const {normalizeCycleInputs}=require('./procurementRecurringCyclePolicy');
const decode=value=>typeof value==='string'?JSON.parse(value):value;
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
  constructor(database=db,notificationService=notifications){this.database=database;this.notifications=notificationService;}
  async _cycleInputs(conn,contract,cycle,lock=false){
    const [events]=await conn.query("SELECT event_snapshot FROM procurement_recurring_cycle_events WHERE cycle_id=? AND event_type='CYCLE_INPUTS_UPDATED' ORDER BY id DESC LIMIT 1"+(lock?' FOR UPDATE':''),[cycle.id]);
    if(events.length)return decode(events[0].event_snapshot);
    const snapshot=decode(cycle.contract_snapshot)||{};
    let items=snapshot.items;
    if(!Array.isArray(items)){
      const [rows]=await conn.query('SELECT id,line_number,family_id,quantity,unit,requirements,allow_substitutions FROM procurement_request_items WHERE request_id=? ORDER BY line_number',[contract.template_request_id]);
      items=rows.map(item=>({...item,template_item_id:Number(item.id)}));
    }
    return {revision:0,items,delivery_preference:null};
  }
  async cycleInputs(buyerId,contractId,cycleId){
    const buyer=id(buyerId,'Buyer'),cid=id(contractId,'Contract'),cyid=id(cycleId,'Cycle');
    const conn=await this.database.getConnection();
    try{
      const [contracts]=await conn.query('SELECT * FROM procurement_recurring_contracts WHERE id=? AND buyer_id=?',[cid,buyer]);
      if(!contracts.length)throw fail('CONTRACT_NOT_FOUND','Recurring contract not found.',404);
      const [cycles]=await conn.query('SELECT * FROM procurement_recurring_cycles WHERE id=? AND contract_id=? AND buyer_id=?',[cyid,cid,buyer]);
      if(!cycles.length)throw fail('CYCLE_NOT_FOUND','Recurring cycle not found.',404);
      return {...await this._cycleInputs(conn,contracts[0],cycles[0]),cycle_id:cyid,status:cycles[0].status,delivery_requires_fresh_quote:true,payment_authorized:false};
    }finally{conn.release();}
  }
  async updateCycleInputs(buyerId,contractId,cycleId,payload,rawKey){
    const buyer=id(buyerId,'Buyer'),cid=id(contractId,'Contract'),cyid=id(cycleId,'Cycle'),key=idem(rawKey);
    const eventKey='INPUTS:'+crypto.createHash('sha256').update(key).digest('hex');
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();await this._verified(conn,buyer);
      const [contracts]=await conn.query('SELECT * FROM procurement_recurring_contracts WHERE id=? AND buyer_id=? FOR UPDATE',[cid,buyer]);
      const contract=contracts[0];if(!contract)throw fail('CONTRACT_NOT_FOUND','Recurring contract not found.',404);
      const [cycles]=await conn.query('SELECT * FROM procurement_recurring_cycles WHERE id=? AND contract_id=? AND buyer_id=? FOR UPDATE',[cyid,cid,buyer]);
      const cycle=cycles[0];if(!cycle)throw fail('CYCLE_NOT_FOUND','Recurring cycle not found.',404);
      const current=await this._cycleInputs(conn,contract,cycle,true);
      const normalized=normalizeCycleInputs(current.items,payload);
      const hash=crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
      const [previous]=await conn.query('SELECT event_snapshot FROM procurement_recurring_cycle_events WHERE cycle_id=? AND event_key=? FOR UPDATE',[cyid,eventKey]);
      if(previous.length){
        const original=decode(previous[0].event_snapshot);
        if(original.request_hash!==hash)throw fail('IDEMPOTENCY_CONFLICT','Cycle intent already used for different inputs.',409);
        await conn.commit();return {...original,is_replay:true};
      }
      if(!['ACTIVE','PAUSED'].includes(contract.status)||cycle.status!=='SCHEDULED')throw fail('CYCLE_ALREADY_COMMITTED','Only an uncommitted active/paused cycle can be edited.',409);
      if(normalized.expected_revision!==Number(current.revision))throw fail('CYCLE_REVISION_CONFLICT','Cycle changed. Reload before editing.',409);
      if(Number(cycle.contract_version)!==Number(contract.version_number))throw fail('CYCLE_CONTRACT_CHANGED','Schedule changed; refresh its cycles.',409);
      const [[clock]]=await conn.query('SELECT (? > UTC_TIMESTAMP()) AS before_cutoff',[cycle.due_at_utc]);
      if(Number(clock.before_cutoff)!==1)throw fail('CYCLE_CUTOFF_PASSED','Cycle cutoff has passed.',409);
      await requestService._validateFamilies(conn,normalized.items);
      const preference=normalized.delivery_preference;
      if(preference?.address_id){
        const [addresses]=await conn.query("SELECT a.id,a.revision,a.cluster_id FROM buyer_delivery_addresses a JOIN geographic_clusters g ON g.id=a.cluster_id AND g.is_active=1 WHERE a.id=? AND a.user_id=? AND a.geographic_match_status='VERIFIED' FOR UPDATE",[preference.address_id,buyer]);
        if(!addresses.length)throw fail('CYCLE_ADDRESS_UNAVAILABLE','Choose your own verified delivery address.',409);
        Object.assign(preference,{address_revision:Number(addresses[0].revision),cluster_id:Number(addresses[0].cluster_id)});
      }
      const result={revision:Number(current.revision)+1,items:normalized.items,delivery_preference:preference,request_hash:hash,cycle_id:cyid,creates_order:false,creates_payment:false,delivery_requires_fresh_quote:true};
      const [[finalClock]]=await conn.query('SELECT (? > UTC_TIMESTAMP()) AS before_cutoff',[cycle.due_at_utc]);
      if(Number(finalClock.before_cutoff)!==1)throw fail('CYCLE_CUTOFF_PASSED','Cycle cutoff passed while validating inputs.',409);
      await conn.query("INSERT INTO procurement_recurring_cycle_events(cycle_id,event_key,event_type,event_snapshot) VALUES (?,?,'CYCLE_INPUTS_UPDATED',?)",[cyid,eventKey,JSON.stringify(result)]);
      const quantitiesChanged=JSON.stringify(current.items.map(item=>String(item.quantity)))!==JSON.stringify(result.items.map(item=>item.quantity));
      await this.notifications.enqueueEvent(conn,{userId:buyer,role:'BUYER',eventType:quantitiesChanged?'CYCLE_QUANTITY_MODIFIED':'CYCLE_DELIVERY_PREFERENCE_UPDATED',eventKey:'cycle:'+cyid+':inputs:'+result.revision,entityId:cid});
      await conn.commit();return {...result,is_replay:false};
    }catch(error){await conn.rollback();throw error;}finally{conn.release();}
  }
  async _verified(conn,buyer){
    const [rows]=await conn.query(
      `SELECT id FROM users WHERE id=? AND role='BUYER' AND is_verified=1
        AND verification_status IN ('VERIFIED','EMAIL_VERIFIED') AND buyer_trust_status<>'SUSPENDED'`,[buyer]);
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
    const transitions={ACTIVATE:['DRAFT'],
      PAUSE:['ACTIVE'],RESUME:['PAUSED'],
      CANCEL:['DRAFT','ACTIVE','PAUSED']};
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
      if(!transitions[action].includes(contract.status))
        throw fail('RECURRING_STATE_CONFLICT','This schedule cannot perform the requested action.',409);
      const expected=contract.status;
      const [updated]=await conn.query(
        `UPDATE procurement_recurring_contracts
         SET status=?,version_number=version_number+1,
         activated_at=CASE WHEN ?='ACTIVATE' THEN UTC_TIMESTAMP() ELSE activated_at END
         WHERE id=? AND buyer_id=? AND status=? AND version_number=?`,
        [target,action,cid,buyer,expected,version]
      );
      if(updated.affectedRows!==1)throw fail('RECURRING_RACE','Contract was concurrently modified.',409);
      if(['PAUSE','RESUME','CANCEL'].includes(action)){
        // Status-only revisions do not change commercial inputs. Rebase only
        // uncommitted proposals; never change generated/paid/historical cycles.
        const [scheduled]=await conn.query("SELECT id,due_at_utc FROM procurement_recurring_cycles WHERE contract_id=? AND status='SCHEDULED' ORDER BY id FOR UPDATE",[cid]);
        for(const cycle of scheduled){
          const [[clock]]=await conn.query('SELECT (? > UTC_TIMESTAMP()) AS before_cutoff',[cycle.due_at_utc]);
          const missed=action==='RESUME'&&Number(clock.before_cutoff)!==1;
          const skipped=action==='CANCEL'||missed;
          await conn.query('UPDATE procurement_recurring_cycles SET contract_version=?,status=?,failure_code=? WHERE id=? AND status=\'SCHEDULED\'',[version+1,skipped?'SKIPPED':'SCHEDULED',missed?'PAUSED_CUTOFF_MISSED':action==='CANCEL'?'CONTRACT_CANCELLED':null,cycle.id]);
          await conn.query('INSERT INTO procurement_recurring_cycle_events(cycle_id,event_key,event_type,event_snapshot) VALUES (?,?,?,?)',[cycle.id,'CONTRACT_VERSION_'+(version+1),missed?'CYCLE_MISSED':'CONTRACT_'+action,JSON.stringify({previous_version:version,contract_version:version+1,action,missed,creates_payment:false})]);
          if(skipped)await this.notifications.enqueueEvent(conn,{userId:buyer,role:'BUYER',eventType:missed?'CYCLE_MISSED':'CYCLE_SKIPPED',eventKey:'cycle:'+cycle.id+':contract:'+(version+1),entityId:cid});
        }
      }
      const [saved]=await conn.query(
        'SELECT * FROM procurement_recurring_contracts WHERE id=?',[cid]);
      if(action==='PAUSE'||action==='RESUME'){
        await this.notifications.enqueueEvent(conn,{userId:buyer,role:'BUYER',
          eventType:action==='PAUSE'?'RECURRING_PAUSED':'RECURRING_RESUMED',
          eventKey:'contract:'+cid+':version:'+(version+1),entityId:cid});
      }
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
  async previewUpcoming(buyerId,contractId){
    const buyer=id(buyerId,'Buyer'),cid=id(contractId,'Contract');
    const [rows]=await this.database.query(
      `SELECT cadence,weekday_number,month_day,month_end_policy,
        local_run_time,timezone_name,starts_on,ends_on,payment_policy,
        pricing_policy,status,version_number
        FROM procurement_recurring_contracts WHERE id=? AND buyer_id=?`,
      [cid,buyer]
    );
    if(!rows.length)throw fail('CONTRACT_NOT_FOUND','Your recurring contract was not found.',404);
    const r=rows[0];
    const date=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
    const schedule={cadence:r.cadence,weekday_number:r.weekday_number,
      month_day:r.month_day,month_end_policy:r.month_end_policy,
      local_run_time:String(r.local_run_time).slice(0,5),
      timezone_name:r.timezone_name,starts_on:date(r.starts_on),
      ends_on:r.ends_on?date(r.ends_on):null,
      payment_policy:r.payment_policy,pricing_policy:r.pricing_policy};
    return {contract_id:cid,status:r.status,
      upcoming:nextCycles(schedule,{from:new Date().toISOString(),limit:6}),
      payment_authorized:false};
  }
  async skipCycle(buyerId,contractId,cycleId){
    const buyer=id(buyerId,'Buyer'),cid=id(contractId,'Contract'),cyid=id(cycleId,'Cycle');
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();
      await this._verified(conn,buyer);
      const [contracts]=await conn.query(
        'SELECT id,buyer_id,status FROM procurement_recurring_contracts WHERE id=? AND buyer_id=? FOR UPDATE',
        [cid,buyer]
      );
      if(!contracts.length)throw fail('CONTRACT_NOT_FOUND','Recurring contract not found.',404);
      const [cycles]=await conn.query(
        `SELECT id,status,due_at_utc FROM procurement_recurring_cycles
         WHERE id=? AND contract_id=? AND buyer_id=? FOR UPDATE`,
        [cyid,cid,buyer]
      );
      const cycle=cycles[0];
      if(!cycle)throw fail('CYCLE_NOT_FOUND','Recurring cycle not found.',404);
      if(cycle.status==='SKIPPED'){
        await conn.commit();return {cycle_id:cyid,status:'SKIPPED',is_replay:true};
      }
      if(cycle.status!=='SCHEDULED')
        throw fail('CYCLE_ALREADY_COMMITTED','Cannot skip a cycle that entered approval, payment or fulfillment.',409);
      const [[clock]]=await conn.query(
        'SELECT (? > UTC_TIMESTAMP()) AS before_cutoff',[cycle.due_at_utc]
      );
      if(Number(clock?.before_cutoff)!==1)
        throw fail('CYCLE_CUTOFF_PASSED','Cycle cutoff has passed.',409);
      await conn.query(
        `UPDATE procurement_recurring_cycles
         SET status='SKIPPED',failure_code='BUYER_SKIPPED'
         WHERE id=? AND status='SCHEDULED'`,[cyid]
      );
      await conn.query(
        `INSERT INTO procurement_recurring_cycle_events
         (cycle_id,event_key,event_type,event_snapshot)
         VALUES (?,'BUYER_SKIP','BUYER_SKIP',?)
         ON DUPLICATE KEY UPDATE id=id`,
        [cyid,JSON.stringify({buyer_id:buyer,skip_before_cutoff:true})]
      );
      await this.notifications.enqueueEvent(conn,{userId:buyer,role:'BUYER',eventType:'CYCLE_SKIPPED',
        eventKey:'cycle:'+cyid+':skipped',entityId:cid});
      await conn.commit();return {cycle_id:cyid,status:'SKIPPED',is_replay:false};
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }

  // B6-M: due cycle generates a ONE_TIME buyer draft; no order or payment.
  async prepareDueCycle(buyerId,contractId,cycleId){
    const buyer=id(buyerId,'Buyer'),cid=id(contractId,'Contract'),cyid=id(cycleId,'Cycle');
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();
      await this._verified(conn,buyer);
      const [contracts]=await conn.query(
        'SELECT * FROM procurement_recurring_contracts WHERE id=? AND buyer_id=? FOR UPDATE',
        [cid,buyer]
      );
      const contract=contracts[0];
      if(!contract)throw fail('CONTRACT_NOT_FOUND','Recurring contract not found.',404);
      const [cycles]=await conn.query(
        'SELECT * FROM procurement_recurring_cycles WHERE id=? AND contract_id=? AND buyer_id=? FOR UPDATE',
        [cyid,cid,buyer]
      );
      const cycle=cycles[0];
      if(!cycle)throw fail('CYCLE_NOT_FOUND','Recurring cycle not found.',404);
      if(cycle.status==='AWAITING_BUYER_APPROVAL' && cycle.generated_request_id){
        await conn.commit();
        return {cycle_id:cyid,request_id:cycle.generated_request_id,
          status:'AWAITING_BUYER_APPROVAL',is_replay:true,creates_order:false};
      }
      if(contract.status!=='ACTIVE'||cycle.status!=='SCHEDULED')
        throw fail('CYCLE_NOT_PREPARABLE','Paused, skipped, processed or cancelled cycle.',409);
      if(Number(cycle.contract_version)!==Number(contract.version_number))
        throw fail('CYCLE_CONTRACT_CHANGED','Schedule version changed; buyer reapproval is required.',409);
      const [[clock]]=await conn.query('SELECT (? <= UTC_TIMESTAMP()) AS due',[cycle.due_at_utc]);
      if(Number(clock?.due)!==1)throw fail('CYCLE_NOT_DUE','Cycle is not yet due.',409);
      const inputs=await this._cycleInputs(conn,contract,cycle,true);
      if(!inputs.items.length)throw fail('CYCLE_WITHOUT_ITEMS','Template is empty.',409);
      await requestService._validateFamilies(conn,inputs.items);
      const [templates]=await conn.query(
        'SELECT id FROM procurement_requests WHERE id=? AND buyer_id=?',
        [contract.template_request_id,buyer]
      );
      if(!templates.length)throw fail('RECURRING_TEMPLATE_MISSING','Procurement template missing.',409);
      const requestKey='recurring-cycle-'+cid+'-'+cycle.cycle_key;
      const requestCode='MJ-RC-'+crypto.randomUUID();
      const requestHash=crypto.createHash('sha256').update(JSON.stringify({
        contract_id:cid,cycle_key:cycle.cycle_key,
        template_request_id:contract.template_request_id,
        schedule_version:contract.version_number,inputs_revision:inputs.revision,
        delivery_preference:inputs.delivery_preference
      })).digest('hex');
      const [request]=await conn.query(
        `INSERT INTO procurement_requests
         (buyer_id,request_code,ownership,frequency,award_policy,priority,
          status,delivery_area,notes,quote_deadline,join_deadline,
          idempotency_key,request_hash)
         SELECT buyer_id,?,'SINGLE_BUYER','ONE_TIME',award_policy,priority,
          'DRAFT',delivery_area,notes,NULL,NULL,?,?
         FROM procurement_requests WHERE id=? AND buyer_id=?`,
        [requestCode,requestKey,requestHash,contract.template_request_id,buyer]
      );
      if(!request.insertId)throw fail('CYCLE_DRAFT_NOT_CREATED','Cycle draft not created.',500);
      for(const item of inputs.items)await conn.query(
        'INSERT INTO procurement_request_items(request_id,line_number,family_id,quantity,unit,requirements,allow_substitutions) VALUES (?,?,?,?,?,?,?)',
        [request.insertId,item.line_number,item.family_id,item.quantity,item.unit,item.requirements,item.allow_substitutions?1:0]);
      await conn.query(
        `UPDATE procurement_recurring_cycles
         SET status='AWAITING_BUYER_APPROVAL',generated_request_id=?,
          last_attempt_at=UTC_TIMESTAMP(),attempt_count=attempt_count+1
         WHERE id=? AND status='SCHEDULED'`,
        [request.insertId,cyid]
      );
      await conn.query(
        `INSERT INTO procurement_recurring_cycle_events
          (cycle_id,event_key,event_type,event_snapshot)
         VALUES (?,'REQUEST_DRAFT_CREATED','REQUEST_DRAFT_CREATED',?)
         ON DUPLICATE KEY UPDATE id=id`,
        [cyid,JSON.stringify({request_id:request.insertId,creates_payment:false,
          creates_order:false,requires_explicit_buyer_approval:true,inputs_revision:inputs.revision,
          delivery_preference:inputs.delivery_preference,delivery_requires_fresh_quote:true})]
      );
      await this.notifications.enqueueEvent(conn,{userId:buyer,role:'BUYER',eventType:'CYCLE_DRAFT_READY',eventKey:'cycle:'+cyid+':draft-ready',entityId:cid});
      await conn.commit();
      return {cycle_id:cyid,request_id:request.insertId,delivery_preference:inputs.delivery_preference,
        status:'AWAITING_BUYER_APPROVAL',is_replay:false,
        creates_order:false,creates_payment:false};
    }catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')
      throw fail('CYCLE_PREPARATION_CONFLICT','Concurrent cycle request; reload first.',409);
      throw e;}finally{conn.release();}
  }
  async listCycles(buyerId,contractId){
    const buyer=id(buyerId,'Buyer'),cid=id(contractId,'Contract');
    const [contracts]=await this.database.query(
      'SELECT id FROM procurement_recurring_contracts WHERE id=? AND buyer_id=?',
      [cid,buyer]
    );
    if(!contracts.length)throw fail('CONTRACT_NOT_FOUND','Recurring contract not found.',404);
    const [cycles]=await this.database.query(
      `SELECT id,cycle_key,due_at_utc,status,generated_request_id,
       attempt_count,failure_code,contract_version
       FROM procurement_recurring_cycles WHERE contract_id=? AND buyer_id=?
       ORDER BY due_at_utc DESC LIMIT 100`,[cid,buyer]
    );
    return cycles;
  }

  // B6-M internal worker entrypoint. Call from a separately controlled job
  // runner; never from a public buyer URL. This only creates unpaid drafts.
  async runDueBatch({limit=20}={}){
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)
      throw fail('INVALID_WORKER_LIMIT','Recurring worker batch size must be 1–100.');
    const [due]=await this.database.query(
      `SELECT cy.id,cy.contract_id,cy.buyer_id,cy.attempt_count
         FROM procurement_recurring_cycles cy
         JOIN procurement_recurring_contracts contract ON contract.id=cy.contract_id
         WHERE cy.status='SCHEDULED' AND contract.status='ACTIVE'
           AND cy.due_at_utc<=UTC_TIMESTAMP()
           AND (cy.retry_after_utc IS NULL OR cy.retry_after_utc<=UTC_TIMESTAMP())
         ORDER BY cy.due_at_utc,cy.id LIMIT ?`,
      [limit]
    );
    const result={checked:due.length,prepared:0,replayed:0,retried:0,failed:0,
      created_orders:0,created_payments:0,outcomes:[]};
    for(const cycle of due){
      try{
        const prepared=await this.prepareDueCycle(
          cycle.buyer_id,cycle.contract_id,cycle.id
        );
        if(prepared.is_replay)result.replayed++;
        else result.prepared++;
        result.outcomes.push({cycle_id:cycle.id,status:prepared.status,
          request_id:prepared.request_id});
      }catch(error){
        // A second worker may have completed the same cycle first.
        if(['CYCLE_NOT_PREPARABLE','CYCLE_NOT_FOUND'].includes(error.code)){
          result.replayed++;
          result.outcomes.push({cycle_id:cycle.id,status:'ALREADY_HANDLED'});
          continue;
        }
        const conn=await this.database.getConnection();
        try{
          await conn.beginTransaction();
          // Consistent contract-before-cycle lock order, same as prepareDueCycle.
          await conn.query(
            'SELECT id FROM procurement_recurring_contracts WHERE id=? FOR UPDATE',
            [cycle.contract_id]
          );
          const [rows]=await conn.query(
            'SELECT id,status,attempt_count FROM procurement_recurring_cycles WHERE id=? AND contract_id=? FOR UPDATE',
            [cycle.id,cycle.contract_id]
          );
          if(!rows.length||rows[0].status!=='SCHEDULED'){
            await conn.commit();result.replayed++;
            continue;
          }
          const attempts=Number(rows[0].attempt_count)+1;
          const permanent=['CYCLE_CONTRACT_CHANGED','RECURRING_TEMPLATE_MISSING',
            'BUYER_NOT_ELIGIBLE','CYCLE_WITHOUT_ITEMS'].includes(error.code);
          const terminal=attempts>=5||permanent;
          const retryMinutes=[5,15,60,240][Math.min(attempts-1,3)];
          await conn.query(
            `UPDATE procurement_recurring_cycles SET
               attempt_count=?,last_attempt_at=UTC_TIMESTAMP(),failure_code=?,
               status=?,retry_after_utc=CASE WHEN ? THEN NULL
                 ELSE DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? MINUTE) END
             WHERE id=? AND status='SCHEDULED'`,
            [attempts,String(error.code||'CYCLE_PREPARATION_FAILED').slice(0,100),
              terminal?'FAILED':'SCHEDULED',terminal?1:0,retryMinutes,cycle.id]
          );
          await conn.query(
            `INSERT INTO procurement_recurring_cycle_events
              (cycle_id,event_key,event_type,event_snapshot)
             VALUES (?,?,'PREPARATION_RETRY',?)
             ON DUPLICATE KEY UPDATE id=id`,
            [cycle.id,'PREPARATION_ATTEMPT_'+attempts,
              JSON.stringify({attempt:attempts,error_code:String(error.code||'UNKNOWN'),
                terminal,no_payment_created:true})]
          );
          if(terminal)await this.notifications.enqueueEvent(conn,{userId:cycle.buyer_id,role:'BUYER',eventType:'CYCLE_MISSED',eventKey:'cycle:'+cycle.id+':terminal',entityId:cycle.contract_id});
          await conn.commit();
          if(terminal)result.failed++;else result.retried++;
          result.outcomes.push({cycle_id:cycle.id,
            status:terminal?'FAILED':'SCHEDULED_FOR_RETRY',
            error_code:error.code||'PREPARATION_FAILED'});
        }catch(updateError){
          await conn.rollback();
          throw updateError;
        }finally{conn.release();}
      }
    }
    return result;
  }

  async scheduleUpcomingForBuyer(buyerId,contractId,{limit=6}={}){
    const buyer=id(buyerId,'Buyer'),cid=id(contractId,'Contract');
    const [owned]=await this.database.query(
      'SELECT id FROM procurement_recurring_contracts WHERE id=? AND buyer_id=?',
      [cid,buyer]
    );
    if(!owned.length)throw fail('CONTRACT_NOT_FOUND','Buyer recurring contract not found.',404);
    return this.prepareUpcoming(cid,{limit});
  }

  async runReminderBatch({limit=20}={}){
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw fail('INVALID_WORKER_LIMIT','Reminder batch size must be 1–100.');
    const [candidates]=await this.database.query(`SELECT cy.id,cy.contract_id,cy.buyer_id FROM procurement_recurring_cycles cy
      JOIN procurement_recurring_contracts c ON c.id=cy.contract_id
      WHERE cy.status='SCHEDULED' AND c.status='ACTIVE' AND cy.contract_version=c.version_number
      AND cy.due_at_utc>UTC_TIMESTAMP() AND cy.due_at_utc<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR)
      AND NOT EXISTS (SELECT 1 FROM procurement_recurring_cycle_events e WHERE e.cycle_id=cy.id AND e.event_key='UPCOMING_24H')
      ORDER BY cy.due_at_utc,cy.id LIMIT ?`,[limit]);
    const result={checked:candidates.length,enqueued:0,skipped:0,failed:0};
    for(const candidate of candidates){
      const conn=await this.database.getConnection();
      try{
        await conn.beginTransaction();
        const [contracts]=await conn.query('SELECT status,version_number FROM procurement_recurring_contracts WHERE id=? AND buyer_id=? FOR UPDATE',[candidate.contract_id,candidate.buyer_id]);
        const [cycles]=await conn.query('SELECT status,contract_version,due_at_utc FROM procurement_recurring_cycles WHERE id=? AND contract_id=? AND buyer_id=? FOR UPDATE',[candidate.id,candidate.contract_id,candidate.buyer_id]);
        const contract=contracts[0],cycle=cycles[0];
        if(!contract||!cycle||contract.status!=='ACTIVE'||cycle.status!=='SCHEDULED'||Number(cycle.contract_version)!==Number(contract.version_number)){
          await conn.commit();result.skipped++;continue;
        }
        await this._verified(conn,candidate.buyer_id);
        const [[clock]]=await conn.query('SELECT (? > UTC_TIMESTAMP() AND ? <= DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR)) AS upcoming',[cycle.due_at_utc,cycle.due_at_utc]);
        const [previous]=await conn.query("SELECT id FROM procurement_recurring_cycle_events WHERE cycle_id=? AND event_key='UPCOMING_24H'",[candidate.id]);
        if(Number(clock.upcoming)!==1||previous.length){await conn.commit();result.skipped++;continue;}
        await conn.query("INSERT INTO procurement_recurring_cycle_events(cycle_id,event_key,event_type,event_snapshot) VALUES (?,'UPCOMING_24H','CYCLE_CUTOFF_UPCOMING',?)",[candidate.id,JSON.stringify({contract_version:cycle.contract_version,due_at_utc:cycle.due_at_utc,payment_authorized:false})]);
        await this.notifications.enqueueEvent(conn,{userId:candidate.buyer_id,role:'BUYER',eventType:'CYCLE_CUTOFF_UPCOMING',eventKey:'cycle:'+candidate.id+':upcoming24h',entityId:candidate.contract_id});
        await conn.commit();result.enqueued++;
      }catch(error){await conn.rollback();result.failed++;}finally{conn.release();}
    }
    return result;
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
      await this._verified(conn,contract.buyer_id);
      const [templateItems]=await conn.query('SELECT id,line_number,family_id,quantity,unit,requirements,allow_substitutions FROM procurement_request_items WHERE request_id=? ORDER BY line_number',[contract.template_request_id]);
      if(!templateItems.length)throw fail('CYCLE_WITHOUT_ITEMS','Template is empty.',409);
      await requestService._validateFamilies(conn,templateItems);
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
            ...input,items:templateItems.map(item=>({...item,template_item_id:Number(item.id)})),payment_authorized:false})]
        );
        await conn.query(
          `INSERT INTO procurement_recurring_cycle_events
           (cycle_id,event_key,event_type,event_snapshot)
           VALUES (?,'CYCLE_SCHEDULED','CYCLE_SCHEDULED',?)
           ON DUPLICATE KEY UPDATE id=id`,
          [result.insertId,JSON.stringify({cycle_key:cycle.cycle_key,
            due_at_utc:cycle.due_at_utc,payment_authorized:false})]
        );
        await this.notifications.enqueueEvent(conn,{userId:contract.buyer_id,role:'BUYER',eventType:'CYCLE_GENERATED',
          eventKey:'cycle:'+result.insertId+':generated',entityId:cid});
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
