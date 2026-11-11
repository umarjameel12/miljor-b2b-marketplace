'use strict';
// B6-N: recurring buyers form a private cohort; every generated cycle is
// a NEW collective RFQ with private invitations and no implied consent.
const crypto=require('node:crypto');
const db=require('../config/db');
const notifications=require('./procurementNotificationService');
const {isCompatibleSchedule,previewRecurringCollective}=require('./procurementCollectiveRecurringPolicy');
const fail=(code,message,statusCode=400)=>Object.assign(new Error(message),{code,statusCode});
const id=v=>{if(v==null||typeof v==='boolean'||!/^[1-9]\d*$/.test(String(v))||
 !Number.isSafeInteger(Number(v)))throw fail('INVALID_ID','Positive ID required.');return Number(v)};
const key=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9:_-]{12,120}$/.test(v))
 throw fail('INVALID_IDEMPOTENCY_KEY','Safe idempotency key must be 12–120 characters.');return v};
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const snapshot=x=>typeof x==='string'?JSON.parse(x):x;
const utc=v=>{
 if(v instanceof Date)return v.getTime();
 if(typeof v==='string'){
  const t=/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d$/.test(v)?v.replace(' ','T')+'Z':v;
  const n=Date.parse(t);
  if(Number.isFinite(n))return n;
 }
 throw fail('INVALID_SERVER_CLOCK','Invalid UTC cycle timestamp.',500);
};
const mysqlDate=t=>new Date(t).toISOString().slice(0,19).replace('T',' ');
class ProcurementCollectiveRecurringService{
 constructor(database=db){this.database=database;}
 async verifiedBuyer(conn,buyer){
  const [rows]=await conn.query("SELECT id FROM users WHERE id=? AND role='BUYER' AND is_verified=1 AND verification_status='VERIFIED' AND buyer_trust_status<>'SUSPENDED'",[buyer]);
  if(!rows.length)throw fail('BUYER_NOT_ELIGIBLE','Active verified B2B buyer required.',403);
 }
 async _contract(conn,buyer,contractId,lock=false){
  const [rows]=await conn.query(
   'SELECT * FROM procurement_recurring_contracts WHERE id=? AND buyer_id=?'+(lock?' FOR UPDATE':''),
   [contractId,buyer]);
  if(!rows.length)throw fail('RECURRING_CONTRACT_NOT_FOUND','Own recurring contract required.',404);
  return rows[0];
 }
 async _cohort(conn,cohortId,lock=false){
  const [rows]=await conn.query('SELECT * FROM procurement_recurring_collectives WHERE id=?'+(lock?' FOR UPDATE':''),[cohortId]);
  if(!rows.length)throw fail('COHORT_NOT_FOUND','Private recurring cohort not found.',404);
  return rows[0];
 }
 async createCohort(buyerId,contractId,payload,rawKey){
  const buyer=id(buyerId),contract=id(contractId),idem=key(rawKey);
  if(payload?.confirm_own_schedule!==true)
   throw fail('ORGANIZER_EXPLICIT_CONSENT_REQUIRED','Organizer must explicitly consent to future cycle invitations.');
  const minimum=Number(payload?.minimum_buyers??2);
  const joinMinutes=Number(payload?.join_cutoff_minutes??60);
  const quoteMinutes=Number(payload?.quote_window_minutes??1440);
  if(!Number.isSafeInteger(minimum)||minimum<2||minimum>1000)
   throw fail('INVALID_COHORT_MINIMUM','Minimum 2–1000 businesses.');
  if(!Number.isSafeInteger(joinMinutes)||joinMinutes<5||joinMinutes>10080||
     !Number.isSafeInteger(quoteMinutes)||quoteMinutes<=joinMinutes||
     quoteMinutes>20160)
   throw fail('INVALID_COHORT_DEADLINES','Quotation cutoff must follow a 5–10080 minute join window.');
  const payloadHash=hash({contract,minimum,joinMinutes,quoteMinutes});
  const conn=await this.database.getConnection();
  try{await conn.beginTransaction();
   await this.verifiedBuyer(conn,buyer);
   const [old]=await conn.query('SELECT id,create_payload_hash,status FROM procurement_recurring_collectives WHERE organizer_buyer_id=? AND create_idempotency_key=? FOR UPDATE',[buyer,idem]);
   if(old.length){
    if(old[0].create_payload_hash!==payloadHash)throw fail('IDEMPOTENCY_CONFLICT','Different cohort settings reused the same key.',409);
    await conn.commit();return {cohort_id:old[0].id,status:old[0].status,is_replay:true};
   }
   const c=await this._contract(conn,buyer,contract,true);
   if(c.status!=='ACTIVE'||c.payment_policy!=='EXPLICIT_PER_CYCLE'||
      c.pricing_policy!=='REQUOTE_EACH_CYCLE')
    throw fail('CONTRACT_NOT_READY','Only active explicitly approved per-cycle re-quote contracts can join.',409);
   const [created]=await conn.query(
    "INSERT INTO procurement_recurring_collectives (organizer_buyer_id,organizer_contract_id,status,minimum_buyers,join_cutoff_minutes,quote_window_minutes,create_idempotency_key,create_payload_hash) VALUES (?,?,'FORMING',?,?,?,?,?)",
    [buyer,contract,minimum,joinMinutes,quoteMinutes,idem,payloadHash]
   );
   await conn.query("INSERT INTO procurement_recurring_collective_members(cohort_id,buyer_id,recurring_contract_id,status,consent_key,consent_hash,consent_snapshot,consent_at) VALUES (?,?,?,'CONSENTED',?,?,?,UTC_TIMESTAMP())",
    [created.insertId,buyer,contract,idem,hash({buyer,contract}),JSON.stringify({
      buyer_id:buyer,contract_id:contract,contract_version:c.version_number,
      per_cycle_requote:true,consent_for_future_invitations_only:true,authorizes_payment:false
    })]);
   await conn.commit();return {cohort_id:created.insertId,status:'FORMING',is_replay:false};
  }catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')throw fail('COHORT_CONFLICT','Concurrent cohort creation.',409);throw e}
  finally{conn.release()}
 }
 async invite(organizerId,cohortId,buyerId){
  const organizer=id(organizerId),cohortIdNum=id(cohortId),buyer=id(buyerId);
  const conn=await this.database.getConnection();
  try{await conn.beginTransaction();
   const group=await this._cohort(conn,cohortIdNum,true);
   if(Number(group.organizer_buyer_id)!==organizer)
    throw fail('ORGANIZER_ONLY','Only the cohort organizer can invite.',403);
   if(!['FORMING','ACTIVE'].includes(group.status))
    throw fail('COHORT_NOT_INVITING','Cohort is paused or closed.',409);
   await this.verifiedBuyer(conn,buyer);
   await conn.query("INSERT INTO procurement_recurring_collective_members(cohort_id,buyer_id,status) VALUES (?,?,'INVITED') ON DUPLICATE KEY UPDATE id=id",[cohortIdNum,buyer]);
   const [rows]=await conn.query('SELECT id,status FROM procurement_recurring_collective_members WHERE cohort_id=? AND buyer_id=?',[cohortIdNum,buyer]);
   if(rows[0].status==='LEFT')throw fail('MEMBER_LEFT','A left participant must explicitly rejoin under a future-policy process.',409);
   await notifications.enqueue(conn,{recipient_id:buyer,recipient_role:'BUYER',
    event_key:'cohort:invite:'+cohortIdNum+':'+buyer,event_type:'COHORT_INVITED',
    payload:{cohort_id:cohortIdNum}});
   await conn.commit();return {member_id:rows[0].id,status:rows[0].status};
  }catch(e){await conn.rollback();throw e}finally{conn.release()}
 }
 async consent(buyerId,cohortId,contractId,rawKey){
  const buyer=id(buyerId),gid=id(cohortId),contract=id(contractId),idem=key(rawKey);
  const consentHash=hash({gid,contract});
  const conn=await this.database.getConnection();
  try{await conn.beginTransaction();
   await this.verifiedBuyer(conn,buyer);
   const cohort=await this._cohort(conn,gid,true);
   if(!['FORMING','ACTIVE'].includes(cohort.status))
    throw fail('COHORT_NOT_OPEN','Cohort cannot accept consent.',409);
   const [rows]=await conn.query('SELECT * FROM procurement_recurring_collective_members WHERE cohort_id=? AND buyer_id=? FOR UPDATE',[gid,buyer]);
   const row=rows[0];
   if(!row)throw fail('PRIVATE_INVITATION_REQUIRED','Buyer must be invited.',403);
   if(row.status==='CONSENTED'){
    if(row.consent_key!==idem||row.consent_hash!==consentHash)
     throw fail('MEMBER_ALREADY_CONSENTED','Consent is immutable; no silent contract replacement.',409);
    await conn.commit();return {member_id:row.id,status:'CONSENTED',is_replay:true};
   }
   if(row.status!=='INVITED')throw fail('MEMBERSHIP_CLOSED','Membership no longer available.',409);
   const own=await this._contract(conn,buyer,contract,true);
   const organizer=await this._contract(conn,cohort.organizer_buyer_id,cohort.organizer_contract_id);
   if(!isCompatibleSchedule(organizer,own))
    throw fail('INCOMPATIBLE_COHORT_SCHEDULE','Weekly/monthly days, timezone, terms or active status do not match.',409);
   const consent={
    buyer_id:buyer,contract_id:contract,contract_version:own.version_number,
    per_cycle_requote:true,consent_for_future_invitations_only:true,
    must_join_and_approve_each_cycle:true,authorizes_payment:false
   };
   await conn.query("UPDATE procurement_recurring_collective_members SET recurring_contract_id=?,status='CONSENTED',consent_key=?,consent_hash=?,consent_snapshot=?,consent_at=UTC_TIMESTAMP() WHERE id=? AND status='INVITED'",
    [contract,idem,consentHash,JSON.stringify(consent),row.id]);
   await conn.commit();return {member_id:row.id,status:'CONSENTED',is_replay:false};
  }catch(e){await conn.rollback();throw e}finally{conn.release()}
 }
 async activate(organizerId,cohortId){
  const organizer=id(organizerId),gid=id(cohortId),conn=await this.database.getConnection();
  try{await conn.beginTransaction();
   const cohort=await this._cohort(conn,gid,true);
   if(Number(cohort.organizer_buyer_id)!==organizer)throw fail('ORGANIZER_ONLY','Organizer required.',403);
   if(cohort.status==='ACTIVE'){await conn.commit();return {cohort_id:gid,status:'ACTIVE',is_replay:true};}
   if(cohort.status!=='FORMING')throw fail('COHORT_STATE_CONFLICT','Only a forming cohort may activate.',409);
   const [rows]=await conn.query("SELECT COUNT(*) AS n FROM procurement_recurring_collective_members WHERE cohort_id=? AND status='CONSENTED'",[gid]);
   if(Number(rows[0].n)<Number(cohort.minimum_buyers))
    throw fail('COHORT_BELOW_MINIMUM','Not enough independently consenting businesses.',409);
   await conn.query("UPDATE procurement_recurring_collectives SET status='ACTIVE',consent_version=consent_version+1 WHERE id=? AND status='FORMING'",[gid]);
   await conn.commit();return {cohort_id:gid,status:'ACTIVE',is_replay:false};
  }catch(e){await conn.rollback();throw e}finally{conn.release()}
 }
 async leaveCohort(buyerId,cohortId){
  const buyer=id(buyerId),gid=id(cohortId),conn=await this.database.getConnection();
  try{await conn.beginTransaction();
   const cohort=await this._cohort(conn,gid,true);
   if(cohort.status==='CANCELLED')
    throw fail('COHORT_CANCELLED','Cohort is no longer active.',409);
   const [members]=await conn.query(
    'SELECT id,status FROM procurement_recurring_collective_members WHERE cohort_id=? AND buyer_id=? FOR UPDATE',[gid,buyer]);
   const member=members[0];
   if(!member)throw fail('COHORT_NOT_FOUND','Your cohort membership not found.',404);
   if(member.status==='LEFT'){await conn.commit();return {cohort_id:gid,status:'LEFT',is_replay:true};}
   if(member.status!=='CONSENTED'&&member.status!=='INVITED')
    throw fail('MEMBERSHIP_STATE_CONFLICT','Membership cannot be left.',409);
   await conn.query("UPDATE procurement_recurring_collective_members SET status='LEFT' WHERE id=?",[member.id]);
   await conn.commit();return {cohort_id:gid,status:'LEFT',
    affects_future_cycles_only:true,existing_cycle_consent_requires_separate_action:true,is_replay:false};
  }catch(e){await conn.rollback();throw e}finally{conn.release()}
 }
 async changeCohortStatus(organizerId,cohortId,action){
  const buyer=id(organizerId),gid=id(cohortId);
  if(!['PAUSE','RESUME','CANCEL'].includes(action))
   throw fail('INVALID_COHORT_ACTION','Unknown cohort action.');
  const targets={PAUSE:'PAUSED',RESUME:'ACTIVE',CANCEL:'CANCELLED'};
  const allowed={PAUSE:['ACTIVE'],RESUME:['PAUSED'],CANCEL:['FORMING','ACTIVE','PAUSED']};
  const conn=await this.database.getConnection();
  try{await conn.beginTransaction();
   const cohort=await this._cohort(conn,gid,true);
   if(Number(cohort.organizer_buyer_id)!==buyer)
    throw fail('ORGANIZER_ONLY','Only organizer controls cohort status.',403);
   const target=targets[action];
   if(cohort.status===target){
    await conn.commit();return {cohort_id:gid,status:target,is_replay:true};
   }
   if(!allowed[action].includes(cohort.status))
    throw fail('COHORT_STATUS_CONFLICT','Illegal cohort status transition.',409);
   await conn.query(
    'UPDATE procurement_recurring_collectives SET status=?,consent_version=consent_version+1 WHERE id=? AND status=?',
    [target,gid,cohort.status]);
   await conn.commit();return {cohort_id:gid,status:target,
    existing_cycle_orders_untouched:true,is_replay:false};
  }catch(e){await conn.rollback();throw e}finally{conn.release()}
 }
 async listMine(buyerId){
  const buyer=id(buyerId);
  const [rows]=await this.database.query(
   "SELECT c.id,c.organizer_buyer_id,c.status,c.minimum_buyers,c.join_cutoff_minutes,c.quote_window_minutes,m.status AS my_status,m.recurring_contract_id FROM procurement_recurring_collective_members m JOIN procurement_recurring_collectives c ON c.id=m.cohort_id WHERE m.buyer_id=? ORDER BY c.id DESC LIMIT 100",
   [buyer]);
  return rows;
 }
 async prepareCycle(organizerId,cohortId,organizerCycleId){
  const organizer=id(organizerId),gid=id(cohortId),cycleId=id(organizerCycleId),conn=await this.database.getConnection();
  try{await conn.beginTransaction();
   await this.verifiedBuyer(conn,organizer);
   const cohort=await this._cohort(conn,gid,true);
   if(Number(cohort.organizer_buyer_id)!==organizer)throw fail('ORGANIZER_ONLY','Organizer required.',403);
   const [cycles]=await conn.query(
    'SELECT id,contract_id,cycle_key,due_at_utc,status,contract_version FROM procurement_recurring_cycles WHERE id=? AND contract_id=? FOR UPDATE',
    [cycleId,cohort.organizer_contract_id]);
   const cy=cycles[0];
   if(!cy)throw fail('RECURRING_CYCLE_NOT_FOUND','Organizer cycle not found.',404);
   const [prior]=await conn.query(
    'SELECT id,status,request_id,group_id,qualification_snapshot FROM procurement_recurring_collective_cycles WHERE cohort_id=? AND cycle_key=? FOR UPDATE',
    [gid,cy.cycle_key]);
   if(prior.length){
    await conn.commit();return {cycle_id:prior[0].id,status:prior[0].status,
      request_id:prior[0].request_id,group_id:prior[0].group_id,is_replay:true};
   }
   if(cohort.status!=='ACTIVE'||cy.status!=='SCHEDULED')
    throw fail('COHORT_CYCLE_NOT_ACTIVE','Cohort or organizer cycle skipped/paused/processed.',409);
   const [[now]]=await conn.query('SELECT UTC_TIMESTAMP() AS now_utc');
   const nowMs=utc(now.now_utc),dueMs=utc(cy.due_at_utc);
   if(dueMs>nowMs)throw fail('COHORT_CYCLE_NOT_DUE','Cannot prepare a future cycle.',409);
   const [enrolled]=await conn.query(
    "SELECT buyer_id,recurring_contract_id,consent_snapshot FROM procurement_recurring_collective_members WHERE cohort_id=? AND status='CONSENTED' ORDER BY buyer_id",
    [gid]);
   const org=await this._contract(conn,organizer,cohort.organizer_contract_id);
   const eligible=[];
   for(const m of enrolled){
    const buyer=Number(m.buyer_id),contractId=Number(m.recurring_contract_id);
    const [active]=await conn.query(
     "SELECT id FROM users WHERE id=? AND role='BUYER' AND is_verified=1 AND verification_status='VERIFIED' AND buyer_trust_status<>'SUSPENDED'",[buyer]);
    if(!active.length)continue;
    const [contracts]=await conn.query('SELECT * FROM procurement_recurring_contracts WHERE id=? AND buyer_id=?',[contractId,buyer]);
    const contract=contracts[0];
    if(!contract||!isCompatibleSchedule(org,contract)||
      Number(snapshot(m.consent_snapshot)?.contract_version)!==Number(contract.version_number))continue;
    const [personalCycle]=await conn.query(
      'SELECT id,status,contract_version,due_at_utc FROM procurement_recurring_cycles WHERE contract_id=? AND cycle_key=?',[contractId,cy.cycle_key]);
    if(personalCycle.length!==1||personalCycle[0].status!=='SCHEDULED'||
       Number(personalCycle[0].contract_version)!==Number(contract.version_number)||
       Math.abs(utc(personalCycle[0].due_at_utc)-dueMs)>60000)continue;
    const [items]=await conn.query(
      'SELECT family_id,unit,quantity,requirements,allow_substitutions FROM procurement_request_items WHERE request_id=? ORDER BY line_number',
      [contract.template_request_id]);
    eligible.push({buyer_id:buyer,contract,status:'CONSENTED',cycle_status:'SCHEDULED',items});
   }
   let policy;
   try{policy=previewRecurringCollective({
     organizerContract:org,members:eligible,minimumBuyers:Number(cohort.minimum_buyers)})}
   catch(e){
    if(e.code!=='COHORT_BELOW_MINIMUM')throw e;
    const evidence={cohort_id:gid,cycle_key:cy.cycle_key,eligible_buyers:eligible.length,
      required_buyers:Number(cohort.minimum_buyers),unqualified:true,
      creates_orders:false,charges_buyers:false};
    const [x]=await conn.query(
      "INSERT INTO procurement_recurring_collective_cycles(cohort_id,organizer_cycle_id,cycle_key,status,qualifying_buyer_count,qualification_snapshot,failure_code) VALUES (?,?,?,'UNQUALIFIED',?,?,'COHORT_BELOW_MINIMUM')",
      [gid,cycleId,cy.cycle_key,eligible.length,JSON.stringify(evidence)]);
    await notifications.enqueue(conn,{recipient_id:organizer,recipient_role:'BUYER',
     event_key:'cohort:unqualified:'+gid+':'+cy.cycle_key,
     event_type:'COHORT_CYCLE_UNQUALIFIED',payload:{cohort_id:gid,cycle_id:x.insertId,status_code:'MINIMUM_NOT_MET'}});
    await conn.commit();
    return {cycle_id:x.insertId,status:'UNQUALIFIED',qualified_buyers:eligible.length,
      creates_orders:false,charges_buyers:false,is_replay:false};
   }
   // New private collective request is an unpaid draft. Never copy participant contact details.
   const joinDeadline=nowMs+Number(cohort.join_cutoff_minutes)*60000;
   const quoteDeadline=nowMs+Number(cohort.quote_window_minutes)*60000;
   const uniqueKey='cohort-cycle-'+gid+'-'+cy.cycle_key;
   const requestHash=hash({gid,cycle_key:cy.cycle_key,products:policy.products});
   const [req]=await conn.query(
    "INSERT INTO procurement_requests(buyer_id,request_code,ownership,frequency,award_policy,priority,status,delivery_area,notes,quote_deadline,join_deadline,idempotency_key,request_hash) SELECT buyer_id,?,'COLLECTIVE','ONE_TIME',award_policy,priority,'DRAFT',delivery_area,notes,?,?,?,? FROM procurement_requests WHERE id=? AND buyer_id=?",
    ['MJ-N-'+crypto.randomUUID(),mysqlDate(quoteDeadline),mysqlDate(joinDeadline),
      uniqueKey,requestHash,org.template_request_id,organizer]);
   if(!req.insertId)throw fail('COHORT_REQUEST_CREATE_FAILED','Could not create cycle request.',500);
   const mapping=new Map();
   for(const [index,p] of policy.products.entries()){
    const [line]=await conn.query(
     'INSERT INTO procurement_request_items(request_id,line_number,family_id,quantity,unit,requirements,allow_substitutions) VALUES (?,?,?,?,?,?,?)',
     [req.insertId,index+1,p.family_id,p.total_quantity,p.unit,p.requirements,p.allow_substitutions?1:0]);
    mapping.set(p.signature,line.insertId);
   }
   const [group]=await conn.query(
    "INSERT INTO procurement_collective_groups(request_id,organizer_buyer_id,visibility,qualification_policy,status,minimum_buyers,join_deadline) VALUES (?,?,'PRIVATE_INVITE','ALL_OR_NOTHING','FORMING',?,?)",
    [req.insertId,organizer,cohort.minimum_buyers,mysqlDate(joinDeadline)]);
   for(const buyer of policy.buyers){
    await conn.query(
     "INSERT INTO procurement_collective_participants(group_id,buyer_id,status) VALUES (?,?,'INVITED')",
     [group.insertId,buyer.buyer_id]);
   }
   const evidence={cohort_id:gid,cycle_key:cy.cycle_key,
    qualifying_buyer_count:policy.qualifying_buyers,
    products:policy.products,
    private_join_mapping:policy.buyers.map(b=>({
     buyer_id:b.buyer_id,contract_id:b.contract_id,
     planned_lines:b.lines.map(l=>({request_item_id:mapping.get(l.signature),quantity:l.quantity}))
    })),
    requires_explicit_cycle_join:true,requires_supplier_quote:true,
    orders_created:false,payments_created:false};
   const [created]=await conn.query(
    "INSERT INTO procurement_recurring_collective_cycles(cohort_id,organizer_cycle_id,cycle_key,status,request_id,group_id,qualifying_buyer_count,qualification_snapshot) VALUES (?,?,?,'INVITING',?,?,?,?)",
    [gid,cycleId,cy.cycle_key,req.insertId,group.insertId,policy.qualifying_buyers,JSON.stringify(evidence)]);
   for(const member of policy.buyers){
    await notifications.enqueue(conn,{recipient_id:member.buyer_id,recipient_role:'BUYER',
     event_key:'cohort:cycle:'+gid+':'+cy.cycle_key+':'+member.buyer_id,
     event_type:'COHORT_CYCLE_READY',
     payload:{cohort_id:gid,cycle_id:created.insertId,group_id:group.insertId,request_id:req.insertId}});
   }
   await conn.commit();
   return {cycle_id:created.insertId,request_id:req.insertId,group_id:group.insertId,
    status:'INVITING',qualified_buyers:policy.qualifying_buyers,
    requires_explicit_cycle_join:true,creates_orders:false,charges_buyers:false,is_replay:false};
  }catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')
    throw fail('COHORT_CYCLE_CONFLICT','Parallel cycle created; refresh and replay.',409);
   throw e;}finally{conn.release()}
 }
 async runDueCollectiveBatch({limit=20}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)
   throw fail('INVALID_WORKER_LIMIT','Batch size must be 1–100.');
  const [due]=await this.database.query(
   "SELECT cohort.id AS cohort_id,cohort.organizer_buyer_id,cy.id AS organizer_cycle_id,cy.cycle_key FROM procurement_recurring_collectives cohort JOIN procurement_recurring_cycles cy ON cy.contract_id=cohort.organizer_contract_id JOIN procurement_recurring_contracts contract ON contract.id=cy.contract_id AND contract.status='ACTIVE' LEFT JOIN procurement_recurring_collective_cycles result ON result.cohort_id=cohort.id AND result.cycle_key=cy.cycle_key LEFT JOIN procurement_recurring_collective_attempts attempt ON attempt.cohort_id=cohort.id AND attempt.cycle_key=cy.cycle_key WHERE cohort.status='ACTIVE' AND cy.status='SCHEDULED' AND cy.due_at_utc<=UTC_TIMESTAMP() AND result.id IS NULL AND (attempt.id IS NULL OR (attempt.status='RETRY' AND (attempt.retry_after_utc IS NULL OR attempt.retry_after_utc<=UTC_TIMESTAMP()))) ORDER BY cy.due_at_utc,cohort.id LIMIT ?",
   [limit]);
  const summary={checked:due.length,prepared:0,unqualified:0,replayed:0,
   retried:0,failed:0,orders_created:0,payments_created:0,outcomes:[]};
  for(const row of due){
   try{
    const result=await this.prepareCycle(
     row.organizer_buyer_id,row.cohort_id,row.organizer_cycle_id);
    const state=result.status;
    if(result.is_replay)summary.replayed++;
    else if(state==='UNQUALIFIED')summary.unqualified++;
    else summary.prepared++;
    summary.outcomes.push({cohort_id:row.cohort_id,
     cycle_key:row.cycle_key,status:state});
   }catch(e){
    if(e.code==='COHORT_CYCLE_CONFLICT'){
     summary.replayed++;
     continue;
    }
    const conn=await this.database.getConnection();
    try{
     await conn.beginTransaction();
     const [cohorts]=await conn.query(
      'SELECT id,status FROM procurement_recurring_collectives WHERE id=? FOR UPDATE',
      [row.cohort_id]);
     if(!cohorts.length||cohorts[0].status!=='ACTIVE'){
      await conn.commit();summary.replayed++;continue;
     }
     await conn.query(
      "INSERT INTO procurement_recurring_collective_attempts(cohort_id,organizer_cycle_id,cycle_key,status) VALUES (?,?,?,'RETRY') ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
      [row.cohort_id,row.organizer_cycle_id,row.cycle_key]);
     const [attempts]=await conn.query(
      'SELECT id,attempt_count,status FROM procurement_recurring_collective_attempts WHERE cohort_id=? AND cycle_key=? FOR UPDATE',
      [row.cohort_id,row.cycle_key]);
     const attempt=attempts[0];
     if(attempt.status!=='RETRY'){
      await conn.commit();summary.replayed++;continue;
     }
     const count=Number(attempt.attempt_count)+1;
     const permanent=['COHORT_NOT_FOUND','INVALID_COHORT_UNIT',
      'COHORT_TOO_MANY_PRODUCTS','INVALID_MEMBER_BASKET',
      'DUPLICATE_COHORT_ITEM','COHORT_CYCLE_NOT_ACTIVE'].includes(e.code);
     const terminal=count>=5||permanent;
     const delays=[5,15,60,240];
     const minutes=delays[Math.min(count-1,delays.length-1)];
     await conn.query(
      "UPDATE procurement_recurring_collective_attempts SET attempt_count=?,status=?,last_error_code=?,retry_after_utc=CASE WHEN ? THEN NULL ELSE DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? MINUTE) END WHERE id=?",
      [count,terminal?'FAILED':'RETRY',
       String(e.code||'CYCLE_PREPARATION_ERROR').slice(0,100),
       terminal?1:0,minutes,attempt.id]);
     await conn.commit();
     if(terminal)summary.failed++;else summary.retried++;
     summary.outcomes.push({cohort_id:row.cohort_id,cycle_key:row.cycle_key,
      status:terminal?'FAILED':'RETRY',error_code:e.code||'CYCLE_PREPARATION_ERROR'});
    }catch(inner){await conn.rollback();throw inner}
    finally{conn.release()}
   }
  }
  return summary;
 }
 async closeExpiredUnderMinimum({limit=20}={}){
  if(!Number.isInteger(limit)||limit<1||limit>100)
   throw fail('INVALID_WORKER_LIMIT','Closure batch must be 1–100.');
  const [due]=await this.database.query(
   "SELECT cy.id AS cycle_id,cy.group_id,g.request_id FROM procurement_recurring_collective_cycles cy JOIN procurement_collective_groups g ON g.id=cy.group_id WHERE cy.status='INVITING' AND g.status='FORMING' AND g.join_deadline<=UTC_TIMESTAMP() AND (SELECT COUNT(DISTINCT p.buyer_id) FROM procurement_collective_participants p WHERE p.group_id=g.id AND p.status='JOINED' AND p.consent_at IS NOT NULL) < g.minimum_buyers ORDER BY g.join_deadline,cy.id LIMIT ?",
   [limit]);
  const result={checked:due.length,unqualified:0,ready_for_bidding:0,replayed:0,
   orders_created:0,payments_created:0};
  for(const item of due){
   const conn=await this.database.getConnection();
   try{
    await conn.beginTransaction();
    // Match the same group-first lock order used by collective joins.
    const [groups]=await conn.query(
     'SELECT id,organizer_buyer_id,request_id,minimum_buyers,status,join_deadline FROM procurement_collective_groups WHERE id=? FOR UPDATE',
     [item.group_id]);
    const g=groups[0];
    if(!g||g.status!=='FORMING'){
     await conn.commit();result.replayed++;continue;
    }
    const [[cutoff]]=await conn.query(
     'SELECT (? <= UTC_TIMESTAMP()) AS closed',[g.join_deadline]);
    if(Number(cutoff?.closed)!==1){
     await conn.commit();result.replayed++;continue;
    }
    const [cycles]=await conn.query(
     "SELECT id,cohort_id,cycle_key,status,qualification_snapshot FROM procurement_recurring_collective_cycles WHERE id=? AND group_id=? FOR UPDATE",
     [item.cycle_id,g.id]);
    const cycle=cycles[0];
    if(!cycle||cycle.status!=='INVITING'){
     await conn.commit();result.replayed++;continue;
    }
    const [countRows]=await conn.query(
     "SELECT COUNT(DISTINCT buyer_id) AS n FROM procurement_collective_participants WHERE group_id=? AND status='JOINED' AND consent_at IS NOT NULL",
     [g.id]);
    const joined=Number(countRows[0]?.n||0);
    if(joined>=Number(g.minimum_buyers)){
     await conn.commit();result.ready_for_bidding++;continue;
    }
    const original=snapshot(cycle.qualification_snapshot);
    const closure={...original,final_joined_buyer_count:joined,
      minimum_required:Number(g.minimum_buyers),
      reason:'BELOW_MINIMUM_AT_JOIN_CUTOFF',
      payments_created:false,orders_created:false,stock_reserved:false};
    await conn.query(
     "UPDATE procurement_collective_groups SET status='FAILED' WHERE id=? AND status='FORMING'",
     [g.id]);
    await conn.query(
     "UPDATE procurement_recurring_collective_cycles SET status='UNQUALIFIED',failure_code='COHORT_BELOW_MINIMUM',qualification_snapshot=? WHERE id=? AND status='INVITING'",
     [JSON.stringify(closure),cycle.id]);
    await conn.query(
     "UPDATE procurement_requests SET status='CANCELLED' WHERE id=? AND status='DRAFT'",
     [g.request_id]);
    const [participants]=await conn.query(
     "SELECT buyer_id FROM procurement_collective_participants WHERE group_id=? ORDER BY buyer_id",
     [g.id]);
    for(const p of participants){
     await notifications.enqueue(conn,{recipient_id:p.buyer_id,recipient_role:'BUYER',
      event_key:'cohort:join-shortfall:'+cycle.cohort_id+':'+cycle.cycle_key+':'+p.buyer_id,
      event_type:'COHORT_CYCLE_UNQUALIFIED',
      payload:{cohort_id:cycle.cohort_id,cycle_id:cycle.id,
       group_id:g.id,status_code:'BELOW_MINIMUM'}});
    }
    await conn.commit();
    result.unqualified++;
   }catch(e){await conn.rollback();throw e}
   finally{conn.release()}
  }
  return result;
 }
 async cycleForBuyer(buyerId,cohortId,cycleId){
  const buyer=id(buyerId),gid=id(cohortId),cid=id(cycleId);
  const [member]=await this.database.query(
   "SELECT id FROM procurement_recurring_collective_members WHERE cohort_id=? AND buyer_id=?",[gid,buyer]);
  if(!member.length)throw fail('COHORT_NOT_FOUND','Private cohort unavailable.',404);
  const [rows]=await this.database.query(
   "SELECT id,cohort_id,cycle_key,status,request_id,group_id,qualifying_buyer_count FROM procurement_recurring_collective_cycles WHERE cohort_id=? AND id=?",
   [gid,cid]);
  if(!rows.length)throw fail('COHORT_CYCLE_NOT_FOUND','Cycle unavailable.',404);
  const [snap]=await this.database.query(
   'SELECT qualification_snapshot FROM procurement_recurring_collective_cycles WHERE id=?',[cid]);
  const details=snapshot(snap[0]?.qualification_snapshot);
  const own=details?.private_join_mapping?.find(m=>Number(m.buyer_id)===buyer);
  if(rows[0].status==='INVITING'&&!own)
   throw fail('BUYER_NOT_ELIGIBLE_FOR_CYCLE','This buyer paused or skipped this occurrence.',403);
  return {...rows[0],own_lines:own?.planned_lines||[],
    must_join_and_approve_each_cycle:true,authorizes_payment:false};
 }
}
module.exports=new ProcurementCollectiveRecurringService();
module.exports.ProcurementCollectiveRecurringService=ProcurementCollectiveRecurringService;
