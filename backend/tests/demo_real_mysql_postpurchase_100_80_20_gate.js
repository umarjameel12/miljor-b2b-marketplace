'use strict';
// REAL MySQL 8 isolated test against the synthetic signed Safepay fixture.
// IMPORTANT: this is NOT a genuine provider-origin payment or payout proof.
// Run only after p0_safepay_signed_http_acceptance.js in disposable miljor_test_db.
const assert=require('node:assert/strict');
const db=require('../src/config/db');
const fulfillment=require('../src/services/fulfillmentService');
const disputes=require('../src/services/disputeService');
const finance=require('../src/services/financialSettlementService');
const invoices=require('../src/services/invoiceService');
const crypto=require('node:crypto');
const jwt=require('jsonwebtoken');
const app=require('../server');
const safe=x=>String(x||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,35);
const nonce=crypto.randomBytes(5).toString('hex');
let passCount=0;
function pass(name){passCount++;console.log('PASS REAL MYSQL 100/80/20 '+passCount+': '+name)}
async function main(){
  for(const [key,value] of Object.entries({
    NODE_ENV:'test',DB_NAME:'miljor_test_db',
    TEST_DB_NAME:'miljor_test_db',
    MILJOR_TEST_ONLY_MIGRATIONS:'1',
    ALLOW_EXTERNAL_MONEY_MOVEMENT:'false',
    SAFEPAY_ENV:'sandbox'
  }))assert.equal(process.env[key],value,'Refusing unsafe execution environment: '+key);
  const [[identity]]=await db.query('SELECT DATABASE() AS db');
  assert.equal(identity.db,'miljor_test_db','PROTECTED_DB_ABORT');
  const [[order]]=await db.query(
    "SELECT id,buyer_id,supplier_id,total_qty,unit_price,total_amount,payment_status,fulfillment_status FROM orders WHERE order_code LIKE 'SFP-%' AND payment_status='PAID' AND fulfillment_status='AWAITING_SUPPLIER_ACKNOWLEDGEMENT' ORDER BY id DESC LIMIT 1"
  );
  assert.ok(order,'Synthetic Safepay test payment fixture must run first');
  assert.equal(Number(order.total_qty),100);
  assert.equal(Number(order.unit_price),10);
  assert.equal(Number(order.total_amount),1145);
  assert.equal(Number(order.buyer_id),5);
  assert.equal(Number(order.supplier_id),2);
  const orderId=Number(order.id);
  const buyer={id:5,role:'BUYER'},supplier={id:2,role:'SUPPLIER'};
  // Actual Express HTTP + JWT test on disposable MySQL. No provider calls.
  assert.ok(process.env.JWT_SECRET && process.env.JWT_SECRET.length>=32);
  const httpServer=app.listen(0);
  const apiBase='http://127.0.0.1:'+httpServer.address().port;
  const token=(id,role)=>jwt.sign({id,role,verification_status:'VERIFIED'},
    process.env.JWT_SECRET,{expiresIn:'10m',issuer:'miljor-api',audience:'miljor-app'});
  async function api(url,id,role,method='GET',body=null){
    const response=await fetch(apiBase+'/api/v1'+url,{
      method,headers:{
        Authorization:'Bearer '+token(id,role),
        'Content-Type':'application/json',
        'X-Idempotency-Key':'TEST-HTTP-'+nonce+'-'+role+'-'+id+'-'+method
      },
      body:body==null?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(15000)
    });
    const raw=await response.text();
    let data;try{data=JSON.parse(raw)}catch{data={raw}};
    return {status:response.status,data};
  }
  const [[paymentBefore]]=await db.query(
    'SELECT id,status,escrow_status,amount FROM payments WHERE order_id=? ORDER BY id DESC LIMIT 1',[orderId]
  );
  assert.equal(paymentBefore.status,'PAID');
  assert.equal(paymentBefore.escrow_status,'HELD_IN_ESCROW');
  assert.equal(Number(paymentBefore.amount),1145);
  pass('Isolated synthetic payment is PAID and funds remain HELD in internal escrow ledger');

  const incoming=await fulfillment.listSupplierFulfillmentOrders({actor:supplier});
  assert.ok(incoming.orders.some(x=>Number(x.order_id)===orderId),'Verified supplier missing paid order');
  pass('Real database supplier queue lists paid test order');
  const supplierHttp=await api('/fulfillment/supplier/orders/'+orderId,2,'SUPPLIER');
  assert.equal(supplierHttp.status,200,JSON.stringify(supplierHttp.data));
  const buyerHttp=await api('/fulfillment/buyer/orders/'+orderId,5,'BUYER');
  assert.equal(buyerHttp.status,200,JSON.stringify(buyerHttp.data));
  const outsider=await api('/fulfillment/buyer/orders/'+orderId,6,'BUYER');
  assert.equal(outsider.status,403,JSON.stringify(outsider.data));
  const wrongRole=await api('/fulfillment/supplier/orders/'+orderId,5,'BUYER');
  assert.equal(wrongRole.status,403,JSON.stringify(wrongRole.data));
  pass('Real JWT HTTP buyer/supplier details and nonowner/cross-role denial');

  const statuses=['PREPARING','READY_FOR_DISPATCH','DISPATCHED','SUPPLIER_DELIVERED'];
  for(const target of statuses){
    const result=await fulfillment.transitionSupplierFulfillment({
      orderId,actor:supplier,toStatus:target,
      deliveryMethod:target==='DISPATCHED'?'STANDARD_DELIVERY':null,
      supplierDeliveryReference:target==='DISPATCHED'?'TEST-ONLY-'+nonce:null,
      notes:'Isolated supplier lifecycle '+target,
      idempotencyKey:'MYSQL-DEMO-'+nonce+'-'+target
    });
    assert.equal(result.fulfillment_status,target);
  }
  const [[delivered]]=await db.query(
    'SELECT fulfillment_status,buyer_confirmed_at FROM orders WHERE id=?',[orderId]
  );
  assert.equal(delivered.fulfillment_status,'SUPPLIER_DELIVERED');
  assert.equal(delivered.buyer_confirmed_at,null);
  pass('Real SQL supplier transition through delivered does not confirm buyer receipt');

  const denied=await api('/fulfillment/buyer/orders/'+orderId+'/report-discrepancy',
    2,'SUPPLIER','POST',{reason:'QUANTITY_MISMATCH',reported_quantity:'80.00',
      description:'Unauthorized supplier acting as buyer'});
  assert.equal(denied.status,403,JSON.stringify(denied.data));
  const discrepancyHttp=await api('/fulfillment/buyer/orders/'+orderId+'/report-discrepancy',
    5,'BUYER','POST',{
      reason:'QUANTITY_MISMATCH',
      reported_quantity:'80.00',
      description:'Only 80 kg received out of 100 kg',
      metadata:{short_quantity:'999.00'}
    });
  assert.equal(discrepancyHttp.status,200,JSON.stringify(discrepancyHttp.data));
  const discrepancy=discrepancyHttp.data.data;
  assert.equal(discrepancy.fulfillment_status,'EXCEPTION');
  assert.equal(discrepancy.receipt_summary.ordered_quantity,'100.00');
  assert.equal(discrepancy.receipt_summary.received_quantity,'80.00');
  assert.equal(discrepancy.receipt_summary.short_quantity,'20.00');
  const [events]=await db.query(
    "SELECT metadata FROM order_fulfillment_events WHERE order_id=? AND action='REPORT_BUYER_DISCREPANCY' ORDER BY id DESC LIMIT 1",[orderId]
  );
  assert.equal(events.length,1);
  const evidence=typeof events[0].metadata==='string'?JSON.parse(events[0].metadata):events[0].metadata;
  assert.equal(evidence.short_quantity,'20.00');
  pass('Buyer shortage 100/80/20 persisted exactly and spoofed metadata ignored');

  const claimHttp=await api('/disputes',5,'BUYER','POST',{
      order_id:orderId,category:'SHORT_QUANTITY',
      description:'20 kg missing from delivered 100 kg contract',
      reported_quantity:'80.00',disputed_quantity:'20.00'
    });
  assert.equal(claimHttp.status,201,JSON.stringify(claimHttp.data));
  const claim=claimHttp.data.data;
  assert.equal(claim.status,'OPEN');
  assert.equal(Number(claim.disputed_quantity),20);
  assert.equal(claim.claimed_amount,'200.00');
  pass('Real MySQL dispute creates exact 20kg x PKR10 = PKR200 claim');

  await assert.rejects(
    fulfillment.confirmBuyerReceipt({
      orderId,actor:buyer,idempotencyKey:'MYSQL-DEMO-'+nonce+'-PREMATURE-CONFIRM'
    }),
    e=>e.code==='UNRESOLVED_DISPUTE_EXISTS'||e.code==='PREREQUISITE_NOT_MET'
  );
  pass('Buyer receipt cannot be silently confirmed while discrepancy/dispute unresolved');

  const refundHttp=await api('/settlements/refunds/assess',5,'BUYER','POST',{
    order_id:orderId,dispute_id:claim.dispute_id,
    disputed_quantity:'20.00',refund_type:'PARTIAL',
    reason:'Twenty kilograms missing on a 100kg paid test-only contract'
  });
  assert.equal(refundHttp.status,201,JSON.stringify(refundHttp.data));
  const assessment=refundHttp.data;
  assert.equal(assessment.success,true);
  assert.equal(String(assessment.data.refund.assessed_refund_amount),'200.00');
  assert.equal(assessment.data.refund.external_execution_status,'DISABLED');
  const replay=await finance.assessRefundObligation({
    orderId,actor:buyer,disputeId:claim.dispute_id,
    disputedQuantity:'20.00',refundType:'PARTIAL',
    reason:'Twenty kilograms missing on a 100kg paid test-only contract',
    idempotencyKey:'TEST-HTTP-'+nonce+'-BUYER-5-POST'
  });
  assert.equal(Number(replay.data.refund.id),Number(assessment.data.refund.id));
  pass('Dispute-scoped PKR200 refund obligation is non-executable and idempotent');

  const issued=await invoices.generateInvoiceForOrder(orderId,buyer);
  const snapshot=typeof issued.invoice_snapshot_json==='string'
    ?JSON.parse(issued.invoice_snapshot_json):issued.invoice_snapshot_json;
  assert.equal(Number(snapshot.pricing.subtotal),1000);
  assert.equal(Number(snapshot.pricing.delivery_fee),120);
  assert.equal(Number(snapshot.pricing.platform_fee),25);
  assert.equal(Number(snapshot.pricing.total_amount),1145);
  pass('Exact persisted invoice line and all fees reconcile to PKR1145');

  const [[after]]=await db.query(
    'SELECT payment_status,fulfillment_status,buyer_confirmed_at FROM orders WHERE id=?',[orderId]
  );
  const [[paymentAfter]]=await db.query(
    'SELECT status,escrow_status,amount FROM payments WHERE order_id=? ORDER BY id DESC LIMIT 1',[orderId]
  );
  const [[refundCount]]=await db.query(
    'SELECT COUNT(*) AS n FROM refund_obligations WHERE order_id=?',[orderId]
  );
  assert.equal(after.payment_status,'PAID');
  assert.equal(after.fulfillment_status,'EXCEPTION');
  assert.equal(after.buyer_confirmed_at,null);
  assert.equal(paymentAfter.escrow_status,'HELD_IN_ESCROW');
  assert.equal(paymentAfter.status,'PAID');
  assert.equal(Number(refundCount.n),1);
  pass('Unresolved 20kg claim cannot release escrow, complete order or create duplicate refunds');
  console.log('REAL MYSQL POSTPURCHASE 100/80/20: '+passCount+'/'+passCount+
    ' PASS; synthetic Safepay fixture only, no provider-issued callback or external refund');
  await new Promise(resolve=>httpServer.close(resolve));
}
main().then(()=>process.exit(0)).catch(e=>{
 console.error('FAIL REAL MYSQL POSTPURCHASE 100/80/20:',e.stack||e);
 process.exit(1);
});
