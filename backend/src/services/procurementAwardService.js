'use strict';

// B6-G/H: One-time supplier-specific order creation from an explicitly
// approved quote/version. All writes share B4/B5 allocation ledger.
// Financial endpoints remain fail-closed until B6/B5 gate acceptance.
const crypto=require('node:crypto');
const db=require('../config/db');
const exact=require('./exactDecimal');
const feeService=require('./feeService');
const matching=require('./procurementMatchingService');
const {buildAwardPreview}=require('./procurementAwardPolicy');

const fail=(code,message,statusCode=400)=>Object.assign(new Error(message),{code,statusCode});
const id=(raw,label)=>{
  if(raw==null||typeof raw==='boolean'||!/^[1-9]\d*$/.test(String(raw))||
     !Number.isSafeInteger(Number(raw)))
    throw fail('INVALID_AWARD_ID',label+' must be a positive integer.');
  return Number(raw);
};
const key=value=>{
  if(typeof value!=='string'||!/^[A-Za-z0-9:_-]{12,120}$/.test(value))
    throw fail('INVALID_IDEMPOTENCY_KEY','X-Idempotency-Key requires 12–120 safe characters.');
  return value;
};
const currency=value=>{
  const v=exact.toCanonical(value,2);
  if(!exact.exactDecimalGte(v,'0.00',2)||v.split('.')[0].length>10)
    throw fail('INVALID_AWARD_MONEY','Invalid PKR amount or order column precision.');
  return v;
};
const cents=value=>BigInt(currency(value).replace('.',''));
const fromCents=v=>(v/100n).toString()+'.'+(v%100n).toString().padStart(2,'0');
const fromDbDate=value=>{
  if(value instanceof Date){
    if(!Number.isFinite(value.getTime()))
      throw fail('INVALID_DB_DATE','Invalid database datetime.',500);
    return value.toISOString();
  }
  if(typeof value!=='string')throw fail('INVALID_DB_DATE','Invalid database datetime.',500);
  const trimmed=value.trim();
  // MySQL DATETIME is UTC without timezone; ISO strings may already carry Z/offset.
  const withZone=/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(trimmed)
    ?trimmed.replace(' ','T')+'Z':trimmed;
  if(!/(?:Z|[+-]\d\d:\d\d)$/i.test(withZone)||
     !Number.isFinite(Date.parse(withZone)))
    throw fail('INVALID_DB_DATE','Timestamp must have an unambiguous UTC offset.',500);
  return new Date(withZone).toISOString();
};
const feeDistribution=(groups,totalFee)=>{
  const feeCents=cents(totalFee);
  const total=cents(exact.exactDecimalSum(groups.map(g=>g.item_subtotal),2));
  if(total<=0n)throw fail('EMPTY_AWARD','Cannot award an empty shopping list.');
  const shares=groups.map(g=>{
    const raw=feeCents*cents(g.item_subtotal);
    return {group:g,base:raw/total,remainder:raw%total};
  });
  let left=feeCents-shares.reduce((sum,x)=>sum+x.base,0n);
  const rank=[...shares].sort((a,b)=>a.remainder>b.remainder?-1:
    a.remainder<b.remainder?1:a.group.supplier_id-b.group.supplier_id);
  for(const part of rank){if(left<=0n)break;part.base+=1n;left-=1n;}
  return new Map(shares.map(x=>[x.group.supplier_id,fromCents(x.base)]));
};

class ProcurementAwardService{
  constructor(database=db){this.database=database;}
  async _draft(conn,buyerId,requestId,lock){
    const [requests]=await conn.query(
      `SELECT id,buyer_id,ownership,frequency,status,delivery_area,quote_deadline
       FROM procurement_requests WHERE id=? AND buyer_id=?${lock?' FOR UPDATE':''}`,
      [requestId,buyerId]);
    if(!requests.length)throw fail('REQUEST_NOT_FOUND','Buyer request not found.',404);
    const request=requests[0];
    const [items]=await conn.query(
      'SELECT id,family_id,quantity,unit,requirements,allow_substitutions FROM procurement_request_items WHERE request_id=? ORDER BY line_number',[requestId]);
    return {...request,items};
  }
  async _currentQuotes(conn,requestId,lock){
    const [rows]=await conn.query(
      `SELECT q.id AS quote_id,q.supplier_id,q.status,q.current_version,
        v.valid_until,v.delivery_fee,v.immutable_snapshot
        FROM procurement_quotes q
        JOIN procurement_quote_versions v
          ON v.quote_id=q.id AND v.version_number=q.current_version
        JOIN users u ON u.id=q.supplier_id AND u.role='SUPPLIER'
          AND u.is_verified=1 AND u.verification_status='VERIFIED'
        JOIN supplier_profiles p ON p.supplier_id=q.supplier_id
          AND p.verification_status='VERIFIED'
        WHERE q.request_id=? ORDER BY q.id${lock?' FOR UPDATE':''}`,[requestId]
    );
    return rows.map(row=>{
      const data=typeof row.immutable_snapshot==='string'
        ?JSON.parse(row.immutable_snapshot):row.immutable_snapshot;
      return {quote_id:row.quote_id,supplier_id:row.supplier_id,status:row.status,
        version_number:row.current_version,valid_until:fromDbDate(row.valid_until),
        delivery_fee:row.delivery_fee,lines:data.lines||[]};
    });
  }
  async _validatedPreview(conn,buyerId,requestId,selections,lock=false){
    const request=await this._draft(conn,buyerId,requestId,lock);
    if(request.ownership!=='SINGLE_BUYER'||request.frequency!=='ONE_TIME')
      throw fail('AWARD_MODE_NOT_IMPLEMENTED','Only single-buyer one-time awards are eligible here.',409);
    if(request.status!=='OPEN')throw fail('REQUEST_NOT_OPEN','Buyer request is not open.',409);
    const [[clock]]=await conn.query(
      'SELECT UTC_TIMESTAMP() AS utc_now, (? > UTC_TIMESTAMP()) AS quote_window_open',
      [request.quote_deadline]);
    if(Number(clock?.quote_window_open)!==1)
      throw fail('QUOTE_WINDOW_CLOSED','Supplier quotation deadline passed.',409);
    const quotes=await this._currentQuotes(conn,requestId,lock);
    const preview=buildAwardPreview({
      requestItems:request.items,quoteVersions:quotes,selections,now:fromDbDate(clock.utc_now)
    });
    return {request,preview};
  }
  async _money(conn,preview){
    const fee=await feeService.calculateBuyerFeeExact(preview.item_subtotal,conn);
    const shares=feeDistribution(preview.groups,fee.buyer_fee);
    const groups=[];
    for(const group of preview.groups){
      const supplierFee=await feeService.calculateSupplierFeeExact(
        group.supplier_id,group.item_subtotal,conn
      );
      const buyerFee=shares.get(group.supplier_id);
      const total=exact.exactDecimalSum([group.item_subtotal,group.delivery_fee,buyerFee],2);
      groups.push({...group,buyer_platform_fee:buyerFee,total_amount:total,
        supplier_commission_percent:supplierFee.fee_percent,
        supplier_transaction_fee:supplierFee.supplier_fee,
        supplier_net_payout:supplierFee.supplier_net_payout});
    }
    const accepted=exact.exactDecimalSum(
      [preview.supplier_quoted_total,fee.buyer_fee],2
    );
    if(!exact.exactDecimalEquals(accepted,
      exact.exactDecimalSum(groups.map(x=>x.total_amount),2),2))
      throw fail('AWARD_FEE_INTEGRITY','Allocated buyer fees do not reconcile.',500);
    return {...preview,groups,buyer_platform_fee_total:fee.buyer_fee,
      total_payable:currency(accepted),currency:'PKR',
      tax_calculated:false,checkout_started:false};
  }
  async previewPayable(buyerId,requestId,selections){
    const buyer=id(buyerId,'Buyer'),request=id(requestId,'Request');
    const {preview}=await this._validatedPreview(
      this.database,buyer,request,selections,false
    );
    const quote=await this._money(this.database,preview);
    return {...quote,status:'PREVIEW_ONLY',inventory_reserved:false,
      final_payable_authorized:false,
      warning:'Current fee-inclusive checkout preflight only, tax policy not configured. Final acceptance revalidates all stock and prices under locks.'};
  }
  async accept(buyerId,requestId,payload,rawKey){
    if(process.env.B6_FINANCIAL_GATE_ENABLED!=='true' ||
       process.env.B6_B5_INVENTORY_RECONCILED!=='true' ||
       process.env.B6_TAX_POLICY_APPROVED!=='true')
      throw fail('B6_FINANCIAL_GATE_BLOCKED',
        'B6-G/H checkout is blocked until accepted B5 inventory, exact tax policy and Safepay evidence pass.',503);
    // This feature is sandbox/test only until real-money authorization is
    // separately granted. Never mutate protected development miljor_db.
    if(!['test','sandbox'].includes(process.env.NODE_ENV))
      throw fail('B6_FINANCIAL_ENVIRONMENT_BLOCKED',
        'B6 financial operations require an isolated approved test/sandbox environment.',503);
    const [[identity]]=await this.database.query('SELECT DATABASE() AS db_name');
    const expectedDatabase=process.env.NODE_ENV==='test'
      ?'miljor_test_db':'miljor_sandbox_db';
    if(identity?.db_name!==expectedDatabase)
      throw fail('B6_PROTECTED_DATABASE_BLOCKED',
        'B6 financial operations refused: database identity is not the approved isolated target.',503);
    // Source-level prerequisite cannot be satisfied by environment flags:
    // accepted B5 Flash checkout claim/release code must be integrated.
    let flashReady=false;
    try{
      const flash=require('./flashPoolService');
      flashReady=typeof flash.releaseCheckoutClaim==='function' &&
        typeof flash.reconcilePaidOrder==='function';
    }catch {flashReady=false;}
    if(!flashReady)
      throw fail('B5_SHARED_STOCK_INTEGRATION_REQUIRED',
        'Accepted B5 Flash checkout/release contracts are not installed in this B6 source.',503);
    // Real schema proof is required as well as the accepted code and flags:
    // 036 Flash holds and the shared B4/B5 inventory allocation ledger.
    const [schema]=await this.database.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN
         ('flash_purchase_holds','supplier_inventory_allocations','procurement_awards',
          'procurement_award_orders','procurement_award_lines')`
    );
    if(schema.length!==5)
      throw fail('B6_FINANCIAL_SCHEMA_NOT_READY',
        'Required accepted Flash, shared-stock and procurement award tables are missing.',503);
    const buyer=id(buyerId,'Buyer'),rid=id(requestId,'Request'),idem=key(rawKey);
    if(!payload||!Array.isArray(payload.selections)||
       payload.buyer_total_confirmed!==true)
      throw fail('EXPLICIT_BUYER_CONFIRMATION_REQUIRED','Buyer must select exact quotes and confirm total.');
    const address=typeof payload.delivery_address==='string'?payload.delivery_address.trim():'';
    if(address.length<8||address.length>1000)
      throw fail('DELIVERY_ADDRESS_REQUIRED','Delivery address must be 8–1000 characters.');
    const expected=currency(payload.accepted_total_payable);
    const hash=crypto.createHash('sha256').update(JSON.stringify({
      request_id:rid,selections:payload.selections,
      delivery_address:address,accepted_total_payable:expected
    })).digest('hex');
    const conn=await this.database.getConnection();
    try{
      await conn.beginTransaction();
      const [buyers]=await conn.query(
        `SELECT id FROM users WHERE id=? AND role='BUYER' AND is_verified=1
          AND verification_status='VERIFIED' AND buyer_trust_status<>'SUSPENDED'`,[buyer]);
      if(!buyers.length)throw fail('BUYER_NOT_ELIGIBLE','Verified active B2B buyer required.',403);
      const [parents]=await conn.query(
        'SELECT id FROM procurement_requests WHERE id=? AND buyer_id=? FOR UPDATE',
        [rid,buyer]
      );
      if(!parents.length)throw fail('REQUEST_NOT_FOUND','Buyer request not found.',404);
      const [existing]=await conn.query(
        `SELECT id,request_id,idempotency_key,payload_hash,original_response_snapshot
           FROM procurement_awards WHERE request_id=? FOR UPDATE`,[rid]
      );
      if(existing.length){
        if(existing[0].idempotency_key!==idem||existing[0].payload_hash!==hash)
          throw fail('AWARD_ALREADY_CONFIRMED',
            'This buyer request already has an immutable selected award.',409);
        const snapshot=existing[0].original_response_snapshot;
        await conn.commit();
        return {award:typeof snapshot==='string'?JSON.parse(snapshot):snapshot,
          is_replay:true};
      }
      const {request,preview}=await this._validatedPreview(
        conn,buyer,rid,payload.selections,false
      );
      // Re-evaluate physical eligibility before locks, then lock every listing
      // in deterministic ascending ID order to serialize B4/B5/B6 capacity.
      const eligible=await matching._candidates(conn,request);
      const eligibleBySupplier=new Map(eligible.map(x=>[
        x.supplier_id,new Set(x.eligible_listing_ids.map(Number))
      ]));
      const byListing=new Map();
      for(const group of preview.groups){
        for(const line of group.lines){
          if(!eligibleBySupplier.get(group.supplier_id)?.has(line.supplier_listing_id))
            throw fail('LISTING_DELIVERY_NOT_ELIGIBLE',
              'Supplier listing, MOQ or delivery zone changed.',409);
          const current=byListing.get(line.supplier_listing_id);
          if(current&&current.supplier_id!==group.supplier_id)
            throw fail('LISTING_OWNER_MISMATCH','A listing belongs to one supplier.',409);
          const joined=current?exact.exactDecimalSum([current.quantity,line.quantity],4):
            exact.toCanonical(line.quantity,4);
          byListing.set(line.supplier_listing_id,{
            supplier_id:group.supplier_id,quantity:joined,
            purchasing_unit:line.unit,supplier_sku_id:line.supplier_sku_id,
            product_spec_id:line.product_spec_id
          });
        }
      }
      for(const [listingId,needed] of [...byListing.entries()].sort((a,b)=>a[0]-b[0])){
        const [listings]=await conn.query(
          `SELECT sl.id,sl.supplier_id,sl.status,sl.currency,sl.available_stock,
            sl.buyer_min_qty,sl.supplier_sku_id,sl.product_spec_id,
            sk.purchasing_unit,sk.status AS sku_status,
            ps.approval_status,ps.lifecycle_status,ps.is_active
           FROM supplier_listings sl
           JOIN supplier_skus sk ON sk.id=sl.supplier_sku_id AND sk.supplier_id=sl.supplier_id
           JOIN product_specifications ps ON ps.id=sl.product_spec_id
             AND ps.supplier_sku_id=sk.id AND ps.supplier_id=sl.supplier_id
           WHERE sl.id=? FOR UPDATE`,[listingId]
        );
        const listing=listings[0];
        if(!listing||Number(listing.supplier_id)!==needed.supplier_id||
          listing.status!=='ACTIVE'||listing.currency!=='PKR'||
          listing.sku_status!=='PUBLISHED'||Number(listing.is_active)!==1||
          listing.approval_status!=='APPROVED'||listing.lifecycle_status!=='PUBLISHED'||
          Number(listing.supplier_sku_id)!==needed.supplier_sku_id||
          Number(listing.product_spec_id)!==needed.product_spec_id||
          String(listing.purchasing_unit).toLowerCase()!==needed.purchasing_unit)
          throw fail('LISTING_REAPPROVAL_REQUIRED',
            'Physical SKU, listing or moderation changed before acceptance.',409);
        if(!exact.exactDecimalGte(needed.quantity,listing.buyer_min_qty,4))
          throw fail('BELOW_BUYER_MINIMUM','Quantity below supplier minimum.',409);
        const [allocations]=await conn.query(
          `SELECT unit,allocated_qty AS qty
           FROM supplier_inventory_allocations
           WHERE supplier_listing_id=? AND status IN ('PENDING','COMMITTED')
           FOR UPDATE`,[listingId]
        );
        if(allocations.some(x=>String(x.unit).toLowerCase()!==needed.purchasing_unit))
          throw fail('INVENTORY_ALLOCATION_UNIT_MISMATCH',
            'Unreconciled B4/B5 listing unit blocks B6 allocation.',409);
        const committed=exact.exactDecimalSum(
          allocations.map(x=>x.qty).concat([needed.quantity]),4
        );
        if(!exact.exactDecimalGte(listing.available_stock,committed,4))
          throw fail('SHARED_INVENTORY_EXHAUSTED',
            'B4/B5 pools or another buyer already allocated this supplier stock.',409);
      }
      const calculated=await this._money(conn,preview);
      if(!exact.exactDecimalEquals(calculated.total_payable,expected,2))
        throw fail('BUYER_REAPPROVAL_REQUIRED',
          'Basket price or fees changed. Review the new checkout total.',409);
      const [awardResult]=await conn.query(
        `INSERT INTO procurement_awards
         (request_id,buyer_id,item_subtotal,supplier_delivery_total,
          buyer_platform_fee_total,accepted_total_payable,currency,
          idempotency_key,payload_hash,buyer_consent_snapshot)
         VALUES (?,?,?,?,?,?,'PKR',?,?,?)`,
        [rid,buyer,calculated.item_subtotal,calculated.supplier_delivery_total,
         calculated.buyer_platform_fee_total,calculated.total_payable,
         idem,hash,JSON.stringify({selections:payload.selections,
           accepted_total_payable:expected,delivery_address:address,
           physical_specifications_accepted:true,buyer_total_confirmed:true})]
      );
      const orderSummary=[];
      for(const group of calculated.groups){
        const code='MJQ-'+crypto.randomBytes(10).toString('hex');
        const [createdOrder]=await conn.query(
          `INSERT INTO orders
          (order_code,buyer_id,supplier_id,total_qty,unit_price,
           subtotal_amount,delivery_fee,buyer_platform_fee,total_amount,
           supplier_commission_percent,currency,delivery_type,delivery_address,payment_status,
           order_status,notes)
          VALUES (?,?,?,1.0000,?,?,?,?,?,?,'PKR','DOORSTEP',?,
                  'AWAITING_PAYMENT','AWAITING_PAYMENT','SMART_PROCUREMENT_BASKET')`,
          [code,buyer,group.supplier_id,group.item_subtotal,
           group.item_subtotal,group.delivery_fee,group.buyer_platform_fee,
           group.total_amount,group.supplier_commission_percent,address]
        );
        const orderId=createdOrder.insertId;
        const [link]=await conn.query(
          `INSERT INTO procurement_award_orders
           (award_id,order_id,supplier_id,item_subtotal,delivery_fee,
            buyer_platform_fee,supplier_transaction_fee,
            supplier_net_payout,total_amount)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [awardResult.insertId,orderId,group.supplier_id,
           group.item_subtotal,group.delivery_fee,group.buyer_platform_fee,
           group.supplier_transaction_fee,group.supplier_net_payout,
           group.total_amount]
        );
        const byOrderListing=new Map();
        for(const line of group.lines){
          await conn.query(
            `INSERT INTO procurement_award_lines
             (award_id,award_order_id,request_item_id,quote_id,quote_version,
              supplier_listing_id,supplier_sku_id,product_spec_id,quantity,
              purchasing_unit,unit_price,subtotal,immutable_sku_snapshot)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [awardResult.insertId,link.insertId,line.request_item_id,
             group.quote_id,group.version_number,line.supplier_listing_id,
             line.supplier_sku_id,line.product_spec_id,line.quantity,
             line.unit,line.unit_price,line.subtotal,
             JSON.stringify(line.supplier_sku_snapshot)]
          );
          const sum=byOrderListing.get(line.supplier_listing_id)||'0.0000';
          byOrderListing.set(line.supplier_listing_id,
            exact.exactDecimalSum([sum,line.quantity],4));
        }
        for(const [listingId,qty] of byOrderListing){
          await conn.query(
            `INSERT INTO supplier_inventory_allocations
             (supplier_listing_id,allocation_type,reference_id,
              allocated_qty,unit,status)
             VALUES (?,'ORDER_DIRECT',?,?,?,'PENDING')`,
            [listingId,orderId,qty,
             byListing.get(listingId).purchasing_unit]
          );
        }
        orderSummary.push({order_id:orderId,order_code:code,
          supplier_id:group.supplier_id,total_amount:group.total_amount,
          item_count:group.lines.length,payment_status:'AWAITING_PAYMENT'});
      }
      await conn.query(
        "UPDATE procurement_requests SET status='AWARD_PENDING' WHERE id=? AND status='OPEN'",[rid]
      );
      const snapshot={award_id:awardResult.insertId,request_id:rid,
        buyer_id:buyer,status:'AWAITING_PAYMENT',currency:'PKR',
        item_subtotal:calculated.item_subtotal,
        supplier_delivery_total:calculated.supplier_delivery_total,
        buyer_platform_fee_total:calculated.buyer_platform_fee_total,
        total_payable:calculated.total_payable,orders:orderSummary,
        buyer_pays_each_supplier_order_separately:true,
        safepay_checkout_not_started:true};
      await conn.query(
        'UPDATE procurement_awards SET original_response_snapshot=? WHERE id=?',
        [JSON.stringify(snapshot),awardResult.insertId]
      );
      await conn.commit();
      return {award:snapshot,is_replay:false};
    }catch(e){
      await conn.rollback();
      if(e.code==='ER_DUP_ENTRY')
        throw fail('AWARD_CONFLICT','Concurrent award committed; fetch your order instead.',409);
      throw e;
    }finally{conn.release();}
  }
  // Safepay calls this INSIDE its cryptographically verified PAID transaction.
  // Existing B4/B5 orders not linked to a B6 award return without mutation.
  async reconcilePaidOrder(conn,orderId){
    const oid=id(orderId,'Order');
    const [links]=await conn.query(
      'SELECT award_id FROM procurement_award_orders WHERE order_id=?',
      [oid]
    );
    if(!links.length)return {handled:false};
    const awardId=Number(links[0].award_id);
    const [awards]=await conn.query(
      'SELECT id,request_id,status FROM procurement_awards WHERE id=? FOR UPDATE',
      [awardId]
    );
    if(!awards.length)
      throw fail('AWARD_INTEGRITY_ERROR','Payment references a missing procurement award.',500);
    const [orders]=await conn.query(
      `SELECT ao.order_id,o.payment_status
         FROM procurement_award_orders ao JOIN orders o ON o.id=ao.order_id
         WHERE ao.award_id=? ORDER BY ao.order_id`,[awardId]
    );
    if(!orders.length||!orders.some(row=>Number(row.order_id)===oid&&row.payment_status==='PAID'))
      throw fail('AWARD_PAYMENT_NOT_VERIFIED','Cannot commit stock for an unverified order.',409);
    await conn.query(
      `UPDATE supplier_inventory_allocations
         SET status='COMMITTED'
         WHERE allocation_type='ORDER_DIRECT' AND reference_id=? AND status='PENDING'`,
      [oid]
    );
    const paid=orders.filter(row=>row.payment_status==='PAID').length;
    const allPaid=paid===orders.length;
    await conn.query(
      'UPDATE procurement_awards SET status=? WHERE id=?',
      [allPaid?'PAID':'PARTIALLY_PAID',awardId]
    );
    if(allPaid)await conn.query(
      "UPDATE procurement_requests SET status='AWARDED' WHERE id=? AND status='AWARD_PENDING'",
      [awards[0].request_id]
    );
    return {handled:true,award_id:awardId,paid_orders:paid,
      total_orders:orders.length,status:allPaid?'PAID':'PARTIALLY_PAID'};
  }

  async getMine(buyerId,awardId){
    const buyer=id(buyerId,'Buyer'),aid=id(awardId,'Award');
    const [awards]=await this.database.query(
      'SELECT * FROM procurement_awards WHERE id=? AND buyer_id=?',[aid,buyer]);
    if(!awards.length)throw fail('AWARD_NOT_FOUND','Buyer award not found.',404);
    const [orders]=await this.database.query(
      `SELECT ao.order_id,ao.supplier_id,ao.item_subtotal,ao.delivery_fee,
        ao.buyer_platform_fee,ao.total_amount,o.order_status,o.payment_status
        FROM procurement_award_orders ao JOIN orders o ON o.id=ao.order_id
        WHERE ao.award_id=? ORDER BY ao.supplier_id`,[aid]
    );
    const paid=orders.filter(x=>x.payment_status==='PAID').length;
    return {id:aid,request_id:awards[0].request_id,
      payment_summary:orders.length>0&&paid===orders.length?'PAID':
       paid>0?'PARTIALLY_PAID':'AWAITING_PAYMENT',
      order_count:orders.length,orders,
      total_payable:awards[0].accepted_total_payable,
      currency:'PKR'};
  }
}
module.exports=new ProcurementAwardService();
module.exports.ProcurementAwardService=ProcurementAwardService;
