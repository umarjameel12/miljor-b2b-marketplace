'use strict';
// Non-binding product-level bargaining. The supplier's accepted/countered price
// becomes payable ONLY if published as a new immutable quote and accepted by buyer.
const crypto=require('node:crypto');
const db=require('../config/db');
const {validateProductCounteroffers,validateSupplierDecision}=require('./procurementCounterofferPolicy');
const fail=(code,message,statusCode=409)=>Object.assign(new Error(message),{code,statusCode});
const id=value=>{
  if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))
    throw fail('INVALID_ID','A valid numeric identifier is required',400);
  return Number(value);
};
const key=value=>{
  if(typeof value!=='string'||!/^[A-Za-z0-9:_-]{12,120}$/.test(value))
    throw fail('INVALID_IDEMPOTENCY_KEY','A valid X-Idempotency-Key is required',400);
  return value;
};
class ProcurementProductCounterofferService{
  constructor(database=db){this.database=database;}
  async submit(buyerId,requestId,quoteId,payload,idemKey){
    const buyer=id(buyerId),request=id(requestId),quote=id(quoteId),idem=key(idemKey);
    const expected=id(payload?.version_number);
    if(!payload||Object.keys(payload).some(k=>!['version_number','lines'].includes(k)))
      throw fail('UNSUPPORTED_COUNTER_FIELD','Only quote version and selected product prices are allowed',400);
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();
      const [owned]=await conn.query(
        "SELECT id,status,quote_deadline FROM procurement_requests WHERE id=? AND buyer_id=? FOR UPDATE",
        [request,buyer]);
      if(!owned.length)throw fail('REQUEST_NOT_FOUND','Request not found',404);
      if(owned[0].status!=='OPEN')throw fail('REQUEST_CLOSED','Procurement request is closed');
      const [[requestClock]]=await conn.query(
        'SELECT quote_deadline>UTC_TIMESTAMP() AS valid FROM procurement_requests WHERE id=?',[request]);
      if(Number(requestClock?.valid)!==1)throw fail('REQUEST_CLOSED','Procurement request has expired');
      const [quotes]=await conn.query(
        `SELECT q.id,q.supplier_id,q.current_version,q.status,v.valid_until
         FROM procurement_quotes q JOIN procurement_quote_versions v
         ON v.quote_id=q.id AND v.version_number=q.current_version
         WHERE q.id=? AND q.request_id=? FOR UPDATE`,[quote,request]);
      if(!quotes.length)throw fail('QUOTE_NOT_FOUND','Quotation not found',404);
      const current=quotes[0];
      if(current.status!=='ACTIVE'||Number(current.current_version)!==expected)
        throw fail('QUOTE_STALE','Refresh the current active quotation');
      const [[quoteClock]]=await conn.query(
        'SELECT valid_until>UTC_TIMESTAMP() AS valid FROM procurement_quote_versions WHERE quote_id=? AND version_number=?',
        [quote,expected]);
      if(Number(quoteClock?.valid)!==1)throw fail('QUOTE_EXPIRED','Quotation expired');
      const [existing]=await conn.query(
        `SELECT * FROM procurement_product_counteroffers WHERE buyer_id=? AND idempotency_key=?
         ORDER BY request_item_id FOR UPDATE`,[buyer,idem]);
      const [quotedLines]=await conn.query(
        `SELECT l.request_item_id,l.unit_price FROM procurement_quote_lines l
         JOIN procurement_quote_versions v ON v.id=l.quote_version_id
         WHERE v.quote_id=? AND v.version_number=?`,[quote,expected]);
      const validated=validateProductCounteroffers({lines:payload.lines},quotedLines);
      if(existing.length){
        const canonical=rows=>rows.map(r=>[Number(r.request_item_id),String(r.buyer_proposed_unit_price),
          String(r.quoted_unit_price)]).sort((a,b)=>a[0]-b[0]);
        const proposed=validated.map(r=>({request_item_id:r.request_item_id,
          buyer_proposed_unit_price:r.proposed_unit_price,quoted_unit_price:r.quoted_unit_price}));
        if(existing.length!==proposed.length||JSON.stringify(canonical(existing))!==JSON.stringify(canonical(proposed))||
          existing.some(r=>Number(r.request_id)!==request||Number(r.quote_id)!==quote||Number(r.quote_version)!==expected))
          throw fail('IDEMPOTENCY_CONFLICT','Idempotency key belongs to another offer');
        await conn.commit();return {counteroffers:existing,is_replay:true};
      }
      const inserted=[];
      for(const line of validated){
        const [result]=await conn.query(
          `INSERT INTO procurement_product_counteroffers
          (request_id,quote_id,quote_version,buyer_id,supplier_id,request_item_id,
           buyer_proposed_unit_price,quoted_unit_price,idempotency_key)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [request,quote,expected,buyer,current.supplier_id,line.request_item_id,
            line.proposed_unit_price,line.quoted_unit_price,idem]);
        inserted.push(result.insertId);
      }
      const [saved]=await conn.query(
        'SELECT * FROM procurement_product_counteroffers WHERE buyer_id=? AND idempotency_key=? ORDER BY request_item_id',
        [buyer,idem]);
      await conn.commit();return {counteroffers:saved,is_replay:false};
    }catch(e){await conn.rollback();
      if(e.code==='ER_DUP_ENTRY')throw fail('COUNTEROFFER_CONFLICT','Counteroffer already exists on this quote version');
      throw e;
    }finally{conn.release();}
  }
  async respond(supplierId,offerId,payload){
    const supplier=id(supplierId),offer=id(offerId);
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();
      const [rows]=await conn.query(
        'SELECT * FROM procurement_product_counteroffers WHERE id=? AND supplier_id=? FOR UPDATE',
        [offer,supplier]);
      if(!rows.length)throw fail('COUNTEROFFER_NOT_FOUND','Counteroffer not found',404);
      const selected=rows[0];
      if(selected.decision!=='OPEN')throw fail('COUNTEROFFER_ALREADY_DECIDED','Counteroffer already resolved');
      const decision=validateSupplierDecision(payload,selected);
      const [quotes]=await conn.query(
        `SELECT q.current_version,q.status,r.status AS request_status,
                (r.quote_deadline>UTC_TIMESTAMP()) AS request_open,
                (v.valid_until>UTC_TIMESTAMP()) AS quote_valid
         FROM procurement_quotes q
         JOIN procurement_requests r ON r.id=q.request_id
         JOIN procurement_quote_versions v ON v.quote_id=q.id
           AND v.version_number=q.current_version
         WHERE q.id=? AND q.supplier_id=? FOR UPDATE`,
        [selected.quote_id,supplier]);
      if(!quotes.length||quotes[0].status!=='ACTIVE'||
        Number(quotes[0].current_version)!==Number(selected.quote_version))
        throw fail('QUOTE_STALE','Refresh the latest active supplier quotation');
      if(quotes[0].request_status!=='OPEN'||Number(quotes[0].request_open)!==1)
        throw fail('REQUEST_CLOSED','The buyer procurement request has closed');
      if(Number(quotes[0].quote_valid)!==1)
        throw fail('QUOTE_EXPIRED','The supplier quotation is no longer valid');
      const [result]=await conn.query(
        `UPDATE procurement_product_counteroffers
         SET decision=?,supplier_proposed_unit_price=?,responded_at=UTC_TIMESTAMP()
         WHERE id=? AND decision='OPEN'`,
        [decision.decision,decision.proposed_unit_price||null,offer]);
      if(result.affectedRows!==1)throw fail('COUNTEROFFER_CONFLICT','Counteroffer changed concurrently');
      const [updated]=await conn.query(
        'SELECT * FROM procurement_product_counteroffers WHERE id=?',[offer]);
      await conn.commit();
      return {counteroffer:updated[0],requires_revised_quote:decision.decision!=='REJECT'};
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }
  async forBuyer(buyerId,requestId){
    const buyer=id(buyerId),request=id(requestId);
    const [owned]=await this.database.query(
      'SELECT id FROM procurement_requests WHERE id=? AND buyer_id=?',[request,buyer]);
    if(!owned.length)throw fail('REQUEST_NOT_FOUND','Request not found',404);
    const [rows]=await this.database.query(
      'SELECT * FROM procurement_product_counteroffers WHERE buyer_id=? AND request_id=? ORDER BY id DESC LIMIT 200',
      [buyer,request]);return rows;
  }
  async forSupplier(supplierId){
    const supplier=id(supplierId);
    const [rows]=await this.database.query(
      `SELECT id,request_id,quote_id,quote_version,request_item_id,quoted_unit_price,
      buyer_proposed_unit_price,supplier_proposed_unit_price,decision,created_at,responded_at
      FROM procurement_product_counteroffers WHERE supplier_id=? ORDER BY id DESC LIMIT 200`,
      [supplier]);return rows;
  }
}
module.exports=new ProcurementProductCounterofferService();
module.exports.ProcurementProductCounterofferService=ProcurementProductCounterofferService;
