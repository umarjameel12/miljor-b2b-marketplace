'use strict';

// B6-F quote negotiation is a NON-BINDING request for a better supplier offer.
// Only an immutable new supplier quote version counts as a response.
const crypto=require('node:crypto');
const db=require('../config/db');
const exact=require('./exactDecimal');

const fail=(code,message,statusCode=400)=>Object.assign(new Error(message),{code,statusCode});
const id=value=>{
  if(typeof value==='boolean'||value===null||value===undefined||
     !/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))
    throw fail('INVALID_ID','A positive numeric identifier is required.');
  return Number(value);
};
const key=value=>{
  if(typeof value!=='string'||!/^[A-Za-z0-9:_-]{12,120}$/.test(value))
    throw fail('INVALID_IDEMPOTENCY_KEY','Provide a valid X-Idempotency-Key.');
  return value;
};
const money=value=>{
  if(value==null||value==='')return null;
  try{
    const v=exact.toCanonical(value,2);
    if(v.split('.')[0].length>12 || !exact.exactDecimalGte(v,'0.01',2))
      throw Error('range');
    return v;
  }catch{throw fail('INVALID_TARGET_TOTAL','Suggested target must be positive PKR with up to two decimal places.');}
};
const contact=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?92|0)\s*3\d{2}[\s().-]*\d{3}[\s().-]*\d{4}/i;
const message=value=>{
  if(typeof value!=='string'||value.trim().length<5||value.trim().length>1000)
    throw fail('INVALID_NEGOTIATION_MESSAGE','Write 5–1000 characters describing the requested improvement.');
  if(contact.test(value))throw fail('DIRECT_CONTACT_NOT_ALLOWED','Use MilJor messages instead of private contact details.');
  return value.trim();
};
class ProcurementNegotiationService{
  constructor(database=db){this.database=database;}
  async requestBetterOffer(buyerId,requestId,quoteId,payload,rawKey){
    const buyer=id(buyerId),rid=id(requestId),qid=id(quoteId),idem=key(rawKey);
    const requestedVersion=id(payload?.version_number);
    const input={message:message(payload?.message),target_total:money(payload?.target_total)};
    const hash=crypto.createHash('sha256').update(JSON.stringify({rid,qid,requestedVersion,...input})).digest('hex');
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();
      const [owned]=await conn.query(
        'SELECT id,status FROM procurement_requests WHERE id=? AND buyer_id=? FOR UPDATE',[rid,buyer]);
      if(!owned.length)throw fail('REQUEST_NOT_FOUND','Buyer request not found.',404);
      const [previous]=await conn.query(
        'SELECT id,request_id,quote_id,requested_version,status,buyer_message,buyer_target_total,created_at,payload_hash,response_snapshot FROM procurement_quote_negotiations WHERE buyer_id=? AND idempotency_key=? FOR UPDATE',
        [buyer,idem]);
      if(previous.length){
        if(previous[0].payload_hash!==hash)
          throw fail('IDEMPOTENCY_CONFLICT','Key already used for a different negotiation.',409);
        const original=previous[0].response_snapshot;
        const negotiation=original
          ?(typeof original==='string'?JSON.parse(original):original)
          :Object.fromEntries(Object.entries(previous[0])
            .filter(([field])=>!['payload_hash','response_snapshot'].includes(field)));
        await conn.commit();
        return {negotiation,is_replay:true};
      }
      if(owned[0].status!=='OPEN')
        throw fail('REQUEST_NOT_OPEN','Only open procurement requests support negotiation.',409);
      const [[clock]]=await conn.query(
        'SELECT (quote_deadline>UTC_TIMESTAMP()) AS open_now FROM procurement_requests WHERE id=?',[rid]);
      if(Number(clock?.open_now)!==1)
        throw fail('REQUEST_EXPIRED','Quote deadline has elapsed.',409);
      const [quotes]=await conn.query(
        `SELECT q.id,q.supplier_id,q.status,q.current_version,v.valid_until
         FROM procurement_quotes q JOIN procurement_quote_versions v
         ON v.quote_id=q.id AND v.version_number=q.current_version
         WHERE q.id=? AND q.request_id=? FOR UPDATE`,[qid,rid]);
      const quote=quotes[0];
      if(!quote)throw fail('QUOTE_NOT_FOUND','Quote not found on this request.',404);
      if(Number(quote.current_version)!==requestedVersion)
        throw fail('QUOTE_VERSION_CHANGED','Supplier changed the quote. Refresh before requesting an improvement.',409);
      if(quote.status!=='ACTIVE')throw fail('QUOTE_NOT_ACTIVE','Cannot negotiate a withdrawn quotation.',409);
      const [[fresh]]=await conn.query(
        'SELECT (? > UTC_TIMESTAMP()) AS quote_valid',[quote.valid_until]);
      if(Number(fresh?.quote_valid)!==1)throw fail('QUOTE_EXPIRED','Supplier quotation has expired.',409);
      const [already]=await conn.query(
        'SELECT id FROM procurement_quote_negotiations WHERE quote_id=? AND requested_version=?',
        [qid,quote.current_version]);
      if(already.length)throw fail('NEGOTIATION_ALREADY_OPEN','An improvement request already exists for this quote version.',409);
      const [inserted]=await conn.query(
        `INSERT INTO procurement_quote_negotiations
         (request_id,quote_id,buyer_id,supplier_id,requested_version,
          buyer_message,buyer_target_total,idempotency_key,payload_hash)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [rid,qid,buyer,quote.supplier_id,quote.current_version,
          input.message,input.target_total,idem,hash]);
      const [rows]=await conn.query(
        `SELECT id,request_id,quote_id,requested_version,status,buyer_message,
                buyer_target_total,created_at FROM procurement_quote_negotiations WHERE id=?`,
        [inserted.insertId]);
      await conn.query(
        'UPDATE procurement_quote_negotiations SET response_snapshot=? WHERE id=? AND buyer_id=?',
        [JSON.stringify(rows[0]),inserted.insertId,buyer]
      );
      await conn.commit();
      return {negotiation:rows[0],is_replay:false};
    }catch(e){
      await conn.rollback();
      if(e.code==='ER_DUP_ENTRY')throw fail('NEGOTIATION_CONFLICT','A request already exists; refresh before retrying.',409);
      throw e;
    }finally{conn.release();}
  }
  async forBuyer(buyerId,requestId){
    const buyer=id(buyerId),rid=id(requestId);
    const [owned]=await this.database.query(
      'SELECT id FROM procurement_requests WHERE id=? AND buyer_id=?',[rid,buyer]);
    if(!owned.length)throw fail('REQUEST_NOT_FOUND','Request not found.',404);
    const [rows]=await this.database.query(
      `SELECT id,request_id,quote_id,supplier_id,requested_version,status,
              buyer_message,buyer_target_total,responded_version,created_at,responded_at
       FROM procurement_quote_negotiations WHERE request_id=?
       ORDER BY created_at DESC,id DESC LIMIT 100`,[rid]);
    return rows;
  }
  async forSupplier(supplierId){
    const supplier=id(supplierId);
    const [rows]=await this.database.query(
      `SELECT n.id,n.request_id,n.quote_id,n.requested_version,n.status,
              n.buyer_message,n.buyer_target_total,n.responded_version,
              n.created_at,n.responded_at
       FROM procurement_quote_negotiations n
       WHERE n.supplier_id=? ORDER BY n.created_at DESC,n.id DESC LIMIT 100`,[supplier]);
    // No buyer identity, contact or private delivery address.
    return rows;
  }
}
module.exports=new ProcurementNegotiationService();
module.exports.ProcurementNegotiationService=ProcurementNegotiationService;
