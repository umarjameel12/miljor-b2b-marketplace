'use strict';
// Dedicated CI only: synthetic paid-status fixtures in ephemeral miljor_test_db.
// No provider verified payment assertion. No protected database accesses.
const crypto=require('node:crypto');
const db=require('../src/config/db');
async function run(){
 const expected={B7_CI_EPHEMERAL_DB:'YES',NODE_ENV:'test',TEST_DB_NAME:'miljor_test_db',DB_NAME:'miljor_test_db'};
 for(const [key,value] of Object.entries(expected))
  if(process.env[key]!==value)throw Error('B7_FIXTURE_GUARD '+key);
 const [[identity]]=await db.query('SELECT DATABASE() AS name');
 if(identity.name!=='miljor_test_db')throw Error('B7_FIXTURE_WRONG_DATABASE');
 const [stock]=await db.query(
  `SELECT l.id listing_id,l.product_spec_id,l.supplier_sku_id,s.purchasing_unit,
    s.supplier_id FROM supplier_listings l
    JOIN supplier_skus s ON s.id=l.supplier_sku_id
    WHERE l.supplier_id=2 AND l.status='ACTIVE' AND s.status='PUBLISHED'
    ORDER BY l.id LIMIT 1`);
 if(stock.length!==1)throw Error('B7_FIXTURE_MISSING_SUPPLIER_LISTING; seed_b6_fixtures required');
 const listing=stock[0];const id=crypto.randomBytes(7).toString('hex');
 const conn=await db.getConnection();
 const result=[];
 try{
  await conn.beginTransaction();
  for(let k=0;k<2;k++){
   const tag='B7-CI-'+id+'-'+(k+1);
   const [request]=await conn.query(
    `INSERT INTO procurement_requests
     (buyer_id,request_code,ownership,frequency,award_policy,priority,status,
      delivery_area,idempotency_key,request_hash)
     VALUES (5,?,'SINGLE_BUYER','ONE_TIME','FULL_BASKET','BEST_VALUE',
     'AWARD_PENDING','Model Town, Lahore',?,?)`,
    [tag,'REQ-'+tag,crypto.createHash('sha256').update(tag).digest('hex')]);
   const [item]=await conn.query(
    `INSERT INTO procurement_request_items
     (request_id,line_number,family_id,quantity,unit,requirements)
     VALUES (?,1,1,100,'bag','Supplier SKU 25kg sack; unit is bag')`,
    [request.insertId]);
   const [invitation]=await conn.query(
    `INSERT INTO procurement_supplier_invitations
     (request_id,supplier_id,status,eligible_line_ids)
     VALUES (?,2,'INTERESTED',?)`,[request.insertId,JSON.stringify([item.insertId])]);
   const [quote]=await conn.query(
    `INSERT INTO procurement_quotes (request_id,supplier_id,invitation_id,status)
     VALUES (?,2,?,'ACTIVE')`,[request.insertId,invitation.insertId]);
   const subtotal='8000.00',delivery='150.00',fee='50.00',total='8200.00';
   const [award]=await conn.query(
    `INSERT INTO procurement_awards
     (request_id,buyer_id,status,item_subtotal,supplier_delivery_total,
      buyer_platform_fee_total,accepted_total_payable,currency,
      idempotency_key,payload_hash,buyer_consent_snapshot)
     VALUES (?,5,'PAID',?,?,?,?,'PKR',?,?,?)`,
    [request.insertId,subtotal,delivery,fee,total,'AW-'+tag,
     crypto.createHash('sha256').update('award'+tag).digest('hex'),
     JSON.stringify({test_only_synthetic_paid_state:true,explicit_buyer_consent:true})]);
   const [order]=await conn.query(
    `INSERT INTO orders
     (order_code,buyer_id,supplier_id,total_qty,unit_price,subtotal_amount,
      delivery_fee,buyer_platform_fee,total_amount,currency,delivery_type,
      delivery_address,payment_status,order_status,notes,fulfillment_status)
     VALUES (?,5,2,1.0000,?,?,?,? ,?,'PKR','DOORSTEP',
      'Model Town Lahore','PAID','PAID','SMART_PROCUREMENT_BASKET',
      'AWAITING_SUPPLIER_ACKNOWLEDGEMENT')`,
    [tag,subtotal,subtotal,delivery,fee,total]);
   const [link]=await conn.query(
    `INSERT INTO procurement_award_orders
     (award_id,order_id,supplier_id,item_subtotal,delivery_fee,buyer_platform_fee,
      supplier_transaction_fee,supplier_net_payout,total_amount)
     VALUES (?,?,2,?,?,?,'0.00',?,?)`,
    [award.insertId,order.insertId,subtotal,delivery,fee,subtotal,total]);
   const [line]=await conn.query(
    `INSERT INTO procurement_award_lines
     (award_id,award_order_id,request_item_id,quote_id,quote_version,
      supplier_listing_id,supplier_sku_id,product_spec_id,quantity,purchasing_unit,
      unit_price,subtotal,immutable_sku_snapshot)
     VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?)`,
    [award.insertId,link.insertId,item.insertId,quote.insertId,
     listing.listing_id,listing.supplier_sku_id,listing.product_spec_id,
     '100.0000',listing.purchasing_unit,'80.00',subtotal,
     JSON.stringify({title:'B6 Test Rice 25kg Bag',purchasing_unit:listing.purchasing_unit})]);
   await conn.query(
    `INSERT INTO payments
     (payment_code,order_id,buyer_id,amount,payment_method,status,escrow_status)
     VALUES (?, ?,5,?,'MOCK_GATEWAY','PAID','HELD_IN_ESCROW')`,
    ['PAY-'+tag,order.insertId,total]);
   result.push({order_id:order.insertId,award_line_id:line.insertId,order_code:tag});
  }
  await conn.commit();
 }catch(e){await conn.rollback();throw e}
 finally{conn.release()}
 console.log('B7_CI_SYNTHETIC_ORDER_IDS='+result.map(x=>x.order_id).join(','));
 console.log('B7_CI_SYNTHETIC_AWARD_LINE_IDS='+result.map(x=>x.award_line_id).join(','));
 console.log('B7_CI_FIXTURE_ONLY: MOCK_GATEWAY paid-state fixtures, not Safepay-verified.');
 await db.end();
}
run().catch(e=>{console.error('B7_CI_FIXTURE_FAILED',e.message);process.exitCode=1});
