'use strict';
// MilJor B6-E supplier-owned, immutable versioned quotations.
// NO inventory allocation, buyer acceptance, payment or checkout occurs here.
const crypto = require('node:crypto');
const db = require('../config/db');
const exact = require('./exactDecimal');
const matching = require('./procurementMatchingService');

const failure = (code,message,statusCode=400) => Object.assign(new Error(message),{code,statusCode});
function positiveId(value){
  const text=String(value ?? '');
  if(!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text)))
    throw failure('INVALID_ID','A valid positive ID is required.');
  return Number(text);
}
function price(value,allowZero=false){
  let result;
  try{
    result=exact.toCanonical(value,2);
    if(result.split('.')[0].length>10 || !exact.exactDecimalGte(result,allowZero?'0.00':'0.01',2))
      throw Error('invalid');
  }catch{throw failure('INVALID_QUOTE_PRICE','An exact positive price (maximum two decimals) is required.');}
  return result;
}
function isWhole(value){return /^\d+\.0000$/.test(value)}
const discrete=new Set(['bag','tin','carton','pack','sack','bundle','bucket','drum','jerrycan']);
function quantity(raw,unit){
  try{
    const value=exact.toCanonical(raw,4);
    if(!exact.exactDecimalGte(value,'0.0001',4) || value.split('.')[0].length>8 ||
       (discrete.has(unit)&&!isWhole(value))) throw Error('invalid');
    return value;
  }catch{throw failure('INVALID_QUOTE_QUANTITY','Quantity must be valid and indivisible packs must be whole.');}
}
function toUtc(value){
  if(typeof value!=='string'||!/(Z|[+-]\d\d:\d\d)$/i.test(value))throw failure('INVALID_QUOTE_DEADLINE','Use an offset-aware future ISO date.');
  const ms=Date.parse(value);
  if(!Number.isFinite(ms)||ms<=Date.now()+60000)throw failure('INVALID_QUOTE_DEADLINE','Quotation validity must be in the future.');
  return new Date(ms).toISOString().slice(0,19).replace('T',' ');
}
function key(raw){
  if(typeof raw!=='string'||!/^[A-Za-z0-9:_-]{12,120}$/.test(raw))
    throw failure('INVALID_IDEMPOTENCY_KEY','X-Idempotency-Key must contain 12–120 safe characters.');
  return raw;
}
function normalize(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
    throw failure('INVALID_QUOTE','Quote must be an object.');
  if(!Array.isArray(payload.lines)||payload.lines.length<1||payload.lines.length>50)
    throw failure('INVALID_QUOTE_LINES','Quote must contain 1–50 lines.');
  const lines=payload.lines.map(line=>({
    request_item_id:positiveId(line?.request_item_id),
    supplier_listing_id:positiveId(line?.supplier_listing_id),
    quantity:line?.quantity,
    unit_price:price(line?.unit_price)
  }));
  if(new Set(lines.map(x=>x.request_item_id)).size!==lines.length)
    throw failure('DUPLICATE_QUOTE_ITEM','Each requested item can be quoted only once.');
  const days=Number(payload.delivery_lead_days);
  if(!Number.isSafeInteger(days)||days<0||days>90)
    throw failure('INVALID_DELIVERY_LEAD','Delivery lead must be 0–90 days.');
  if(payload.supplier_notes != null && (typeof payload.supplier_notes!=='string'||payload.supplier_notes.length>2000))
    throw failure('INVALID_QUOTE_NOTES','Supplier notes must be under 2000 characters.');
  return {lines,delivery_fee:price(payload.delivery_fee??'0',true),
    delivery_lead_days:days,supplier_notes:payload.supplier_notes?.trim()||null,
    valid_until:toUtc(payload.valid_until)};
}
class ProcurementQuoteService{
  constructor(database=db){this.database=database;}
  async submit(supplierId,requestId,payload,idempotencyKey){
    const supplier=positiveId(supplierId),rid=positiveId(requestId),idem=key(idempotencyKey);
    const input=normalize(payload);
    const hash=crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();
      // Parent request is always locked before quote rows to serialize close/withdraw/revisions.
      const [requests]=await conn.query(
        `SELECT id, status, quote_deadline, delivery_area
           FROM procurement_requests WHERE id=? FOR UPDATE`,[rid]);
      if(!requests.length)throw failure('REQUEST_NOT_FOUND','Request not found.',404);
      // Durable response replay precedes expiry and stock checks: retries must
      // return the exact historic quote even if it has since expired or sold out.
      const [existingQuotes]=await conn.query(
        'SELECT id,status,current_version FROM procurement_quotes WHERE request_id=? AND supplier_id=? FOR UPDATE',
        [rid,supplier]
      );
      let quote=existingQuotes[0];
      if(quote){
        const [prior]=await conn.query(
          'SELECT payload_hash,immutable_snapshot FROM procurement_quote_versions WHERE quote_id=? AND idempotency_key=?',
          [quote.id,idem]
        );
        if(prior.length){
          if(prior[0].payload_hash!==hash)
            throw failure('IDEMPOTENCY_CONFLICT','This key was used for a different quote.',409);
          const original=typeof prior[0].immutable_snapshot==='string'
            ?JSON.parse(prior[0].immutable_snapshot):prior[0].immutable_snapshot;
          await conn.commit();
          return {...original,is_replay:true};
        }
      }
      if(requests[0].status!=='OPEN')throw failure('REQUEST_NOT_OPEN','Request is not open.',409);
      const [[fresh]]=await conn.query(
        'SELECT (quote_deadline > UTC_TIMESTAMP()) AS active FROM procurement_requests WHERE id=?',[rid]);
      if(Number(fresh?.active)!==1)throw failure('REQUEST_EXPIRED','Request deadline has passed.',409);
      const [inviteRows]=await conn.query(
        `SELECT id,status FROM procurement_supplier_invitations
         WHERE request_id=? AND supplier_id=? FOR UPDATE`,[rid,supplier]);
      if(!inviteRows.length||inviteRows[0].status!=='INTERESTED')
        throw failure('INVITATION_REQUIRED','Supplier must accept an invitation before quoting.',403);
      const [verified]=await conn.query(
        `SELECT u.id FROM users u
         JOIN supplier_profiles p ON p.supplier_id=u.id
         WHERE u.id=? AND u.role='SUPPLIER' AND u.is_verified=1
           AND u.verification_status='VERIFIED' AND p.verification_status='VERIFIED'`,[supplier]);
      if(!verified.length)throw failure('SUPPLIER_NOT_VERIFIED','Supplier is not eligible.',403);
      const [items]=await conn.query(
        'SELECT id,family_id,quantity,unit,allow_substitutions FROM procurement_request_items WHERE request_id=? ORDER BY line_number',[rid]);
      const itemMap=new Map(items.map(item=>[Number(item.id),item]));
      const candidates=await matching._candidates(conn,{...requests[0],items});
      const supplierCandidate=candidates.find(candidate=>candidate.supplier_id===supplier);
      if(!supplierCandidate)throw failure('SUPPLIER_NOT_ELIGIBLE','No eligible supplier listing remains in this delivery area.',409);
      const listingAllowed=new Set(supplierCandidate.eligible_listing_ids.map(Number));
      let total='0.00';
      const snapshots=[];
      for(const line of input.lines){
        const item=itemMap.get(line.request_item_id);
        if(!item)throw failure('INVALID_QUOTE_ITEM','Quotation contains an unrequested line.',409);
        if(!listingAllowed.has(line.supplier_listing_id))
          throw failure('LISTING_NOT_ELIGIBLE','Listing is not eligible for this delivery area and request.',409);
        const [rows]=await conn.query(
          `SELECT sl.id AS listing_id, sl.supplier_id, sl.supplier_sku_id,
                  sl.available_stock,sl.currency,sl.status,sl.delivery_zones,
                  sk.family_id,sk.purchasing_unit,sk.pack_size,sk.pack_unit,
                  sk.packaging_type,sk.linked_spec_id,sk.sku_code,
                  sp.title,sp.brand,sp.quality_grade,sp.variety,
                  ps.id AS spec_id,ps.approval_status,ps.lifecycle_status
           FROM supplier_listings sl
           JOIN supplier_skus sk ON sk.id=sl.supplier_sku_id
              AND sk.supplier_id=sl.supplier_id AND sk.status='PUBLISHED'
           JOIN supplier_products sp ON sp.id=sk.supplier_product_id
              AND sp.supplier_id=sl.supplier_id AND sp.status='PUBLISHED'
           JOIN product_specifications ps ON ps.id=sl.product_spec_id
              AND ps.supplier_id=sl.supplier_id AND ps.supplier_sku_id=sk.id
              AND ps.is_active=1 AND ps.approval_status='APPROVED'
              AND ps.lifecycle_status='PUBLISHED'
           JOIN catalog_product_families f ON f.id=sk.family_id
              AND f.is_active=1 AND f.approval_status='APPROVED'
           JOIN catalog_categories cat ON cat.id=f.category_id
              AND cat.is_active=1 AND cat.approval_status='APPROVED'
           WHERE sl.id=? AND sl.supplier_id=? AND sl.status='ACTIVE'
             AND sl.currency='PKR' LIMIT 1`,
          [line.supplier_listing_id,supplier]
        );
        if(!rows.length)throw failure('LISTING_NOT_ELIGIBLE','Supplier listing or specification is not eligible.',409);
        const sku=rows[0];
        const unit=String(sku.purchasing_unit).toLowerCase();
        if(Number(sku.family_id)!==Number(item.family_id)||unit!==String(item.unit).toLowerCase())
          throw failure('PHYSICAL_SPEC_MISMATCH','The supplier SKU cannot satisfy the requested family/unit.',409);
        const qty=quantity(line.quantity,unit);
        if(!exact.exactDecimalEquals(qty,item.quantity,4))
          throw failure('QUOTE_QUANTITY_MISMATCH','Quoted line must cover the entire requested item quantity.',409);
        if(!exact.exactDecimalGte(sku.available_stock,qty,4))
          throw failure('INSUFFICIENT_LISTING_STOCK','Listed stock cannot cover this quote.',409);
        // Discovery requirements are free text, not machine-verifiable equivalence.
        // A buyer may specify grade/brand; supplier's exact SKU snapshot is disclosed
        // and acceptance must require explicit buyer selection in phase B6-G.
        const snapshot={supplier_sku_id:sku.supplier_sku_id,sku_code:sku.sku_code,
          product_title:sku.title,brand:sku.brand,variety:sku.variety,
          quality_grade:sku.quality_grade,packaging_type:sku.packaging_type,
          pack_size:String(sku.pack_size),pack_unit:sku.pack_unit,
          purchasing_unit:sku.purchasing_unit,product_spec_id:sku.spec_id};
        const subtotal=exact.exactMultiplyRound(qty,line.unit_price,2);
        total=exact.exactDecimalSum([total,subtotal],2);
        snapshots.push({...line,quantity:qty,unit_price:line.unit_price,subtotal,
          supplier_sku_id:sku.supplier_sku_id,snapshot});
      }
      // Quote validity must remain in the future after obtaining parent lock.
      const [[clock]]=await conn.query(
        'SELECT (UTC_TIMESTAMP() < ?) AS future_validity',[input.valid_until]
      );
      if(Number(clock?.future_validity)!==1)
        throw failure('QUOTE_EXPIRED','Supplier quote validity expired while submitting.',409);
      if(quote){
        if(quote.status!=='ACTIVE')throw failure('QUOTE_WITHDRAWN','Withdrawn quotes cannot be revised.',409);
      }else{
        const [created]=await conn.query(
          `INSERT INTO procurement_quotes (request_id,supplier_id,invitation_id,status,current_version)
           VALUES (?,?,?,'ACTIVE',1)`,[rid,supplier,inviteRows[0].id]);
        quote={id:created.insertId,current_version:0,status:'ACTIVE'};
      }
      const version=Number(quote.current_version)+1;
      const coverage=snapshots.length===items.length?'FULL_BASKET':'PARTIAL';
      const payable=exact.exactDecimalSum([total,input.delivery_fee],2);
      const response={quote_id:quote.id,request_id:rid,supplier_id:supplier,
        version_number:version,coverage,items_total:total,delivery_fee:input.delivery_fee,
        quoted_total:payable,delivery_lead_days:input.delivery_lead_days,
        valid_until:input.valid_until,supplier_notes:input.supplier_notes,lines:snapshots};
      const [saved]=await conn.query(
        `INSERT INTO procurement_quote_versions
           (quote_id,version_number,coverage,valid_until,delivery_fee,delivery_lead_days,
            supplier_notes,items_total,quoted_total,immutable_snapshot,idempotency_key,payload_hash)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [quote.id,version,coverage,input.valid_until,input.delivery_fee,
          input.delivery_lead_days,input.supplier_notes,total,payable,
          JSON.stringify(response),idem,hash]
      );
      for(const line of snapshots){
        await conn.query(
          `INSERT INTO procurement_quote_lines
            (quote_version_id,request_item_id,supplier_listing_id,supplier_sku_id,
             quantity,purchasing_unit,unit_price,subtotal,supplier_sku_snapshot)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [saved.insertId,line.request_item_id,line.supplier_listing_id,line.supplier_sku_id,
            line.quantity,line.snapshot.purchasing_unit,line.unit_price,line.subtotal,
            JSON.stringify(line.snapshot)]
        );
      }
      await conn.query(
        'UPDATE procurement_quotes SET current_version=? WHERE id=?',
        [version,quote.id]
      );
      await conn.commit();
      return {...response,is_replay:false};
    }catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')
      throw failure('QUOTE_CONFLICT','Concurrent quotation detected; refresh before retrying.',409);
      throw e;
    }finally{conn.release();}
  }
  async getForBuyer(buyerId,requestId){
    const buyer=positiveId(buyerId),rid=positiveId(requestId);
    const [requests]=await this.database.query(
      'SELECT id FROM procurement_requests WHERE id=? AND buyer_id=?',[rid,buyer]);
    if(!requests.length)throw failure('REQUEST_NOT_FOUND','Request not found.',404);
    const [rows]=await this.database.query(
      `SELECT q.id,q.supplier_id,u.business_name AS supplier_name,q.status,
              q.current_version,v.coverage,v.valid_until,v.items_total,v.delivery_fee,
              v.quoted_total,v.delivery_lead_days,v.immutable_snapshot
       FROM procurement_quotes q
       JOIN procurement_quote_versions v ON v.quote_id=q.id AND v.version_number=q.current_version
       JOIN users u ON u.id=q.supplier_id WHERE q.request_id=?
       ORDER BY q.id`,[rid]);
    return rows.map(row=>({...row,quote_snapshot:
      typeof row.immutable_snapshot==='string'?JSON.parse(row.immutable_snapshot):row.immutable_snapshot,
      immutable_snapshot:undefined}));
  }
  async getMine(supplierId){
    const sid=positiveId(supplierId);
    const [rows]=await this.database.query(
      `SELECT q.id,q.request_id,q.status,q.current_version,
              v.coverage,v.valid_until,v.quoted_total,v.immutable_snapshot
       FROM procurement_quotes q JOIN procurement_quote_versions v
       ON v.quote_id=q.id AND v.version_number=q.current_version
       WHERE q.supplier_id=? ORDER BY q.updated_at DESC LIMIT 100`,[sid]);
    return rows.map(row=>({...row,quote_snapshot:
      typeof row.immutable_snapshot==='string'?JSON.parse(row.immutable_snapshot):row.immutable_snapshot,
      immutable_snapshot:undefined}));
  }
}
module.exports=new ProcurementQuoteService();
module.exports.ProcurementQuoteService=ProcurementQuoteService;
