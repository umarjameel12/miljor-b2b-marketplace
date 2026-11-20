'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const root=path.resolve(__dirname,'../src/services');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const fulfillment=read('fulfillmentService.js');
const flash=read('flashPoolService.js');
const {eventProjection}=require('../src/services/notificationEventPolicy');
function method(source,name,next){
 const start=source.indexOf(name);
 assert.notEqual(start,-1,'missing method '+name);
 const end=next?source.indexOf(next,start+name.length):-1;
 return source.slice(start,end<0?source.length:end);
}
test('supplier fulfillment milestones enqueue buyer notices before transaction commit',()=>{
 const body=method(fulfillment,'async transitionSupplierFulfillment(','async recordSupplierFulfillmentException(');
 assert.match(body,/READY_FOR_DISPATCH:'DISPATCH_SCHEDULED'/);
 assert.match(body,/DISPATCHED:'OUT_FOR_DELIVERY'/);
 assert.match(body,/SUPPLIER_DELIVERED:'DELIVERY_REPORTED'/);
 assert.match(body,/userId:Number\(order\.buyer_id\),role:'BUYER'/);
 assert.ok(body.indexOf('notificationService.enqueueEvent')<body.indexOf('await connection.commit()'));
});
test('supplier exception and buyer receipt/dispute notify the counterparty transactionally',()=>{
 const exception=method(fulfillment,'async recordSupplierFulfillmentException(','async listBuyerFulfillmentOrders(');
 const receipt=method(fulfillment,'async confirmBuyerReceipt(','async reportBuyerDiscrepancy(');
 const dispute=method(fulfillment,'async reportBuyerDiscrepancy(','async getAdminFulfillmentOrderById(');
 for(const [body,event,role,field] of [
  [exception,'DELIVERY_DELAYED','BUYER','buyer_id'],
  [receipt,'RECEIPT_CONFIRMED','SUPPLIER','supplier_id'],
  [dispute,'DISPUTE_OPENED','SUPPLIER','supplier_id']
 ]){
  assert.match(body,new RegExp("eventType:'"+event+"'"));
  assert.match(body,new RegExp("userId:Number\\(order\\."+field+"\\),role:'"+role+"'"));
  assert.ok(body.indexOf('notificationService.enqueueEvent')<body.indexOf('await connection.commit()'));
 }
});
test('dispute creation, supplier shortage and supplier response notify the correct counterparty',()=>{
 const dispute=read('disputeService.js');
 const buyerFiled=method(dispute,'async createBuyerDispute(','async createSupplierShortageException(');
 const shortage=method(dispute,'async createSupplierShortageException(','async submitSupplierResponse(');
 const response=method(dispute,'async submitSupplierResponse(','async declareSupplierRemediationDispatched(');
 for(const [body,event,role,field] of [
  [buyerFiled,'DISPUTE_OPENED','SUPPLIER','order.supplier_id'],
  [shortage,'DISPUTE_OPENED','BUYER','order.buyer_id'],
  [response,'DISPUTE_RESPONSE_RECEIVED','BUYER','dispute.buyer_id']
 ]){
  assert.match(body,new RegExp("eventType:'"+event+"'"));
  assert.match(body,new RegExp("userId:Number\\("+field.replaceAll('.','\\.')+"\\),role:'"+role+"'"));
  assert.ok(body.indexOf('notificationService.enqueueEvent')<body.indexOf('await connection.commit()'));
 }
});
test('Flash offer publish, cancel and expiry are projected into the UCP event stream',()=>{
 const cancel=method(flash,'async cancelOffer(','async getSupplierOffer(');
 const publish=method(flash,'async publish(','async getActive(');
 const expiry=method(flash,'async _closeExpiredOffer(','\n}\nmodule.exports');
 for(const [body,type] of [[cancel,'UCP.POOL_CANCELLED'],[publish,'UCP.POOL_PUBLISHED'],[expiry,'UCP.POOL_EXPIRED']]){
  assert.ok(body.includes("type:'"+type+"'"));
  assert.ok(body.indexOf('recordFlashOnConnection')<body.indexOf('await conn.commit()'));
 }
});
test('Flash hold, verified payment and expiry have recipient-owned transactional events',()=>{
 const hold=method(flash,'async requestHold(','async claimCheckout(');
 const paid=method(flash,'async reconcilePaidOrder(','async listHoldsForBuyer(');
 const expiry=method(flash,'async reclaimExpiredUninitiatedHolds(','async reconcilePaidOrder(');
 assert.match(hold,/eventType:'PAYMENT_PENDING'/);
 assert.match(hold,/role:'BUYER'/);
 assert.ok(hold.indexOf('notificationService.enqueueEvent')<hold.indexOf('await conn.commit()'));
 assert.match(paid,/eventType:'PAYMENT_VERIFIED'/);
 assert.match(paid,/role:'BUYER'/);
 assert.match(paid,/role:'SUPPLIER'/);
 assert.ok(paid.indexOf('notificationService.enqueueEvent')<paid.indexOf('await conn.commit()'));
 assert.match(expiry,/eventType:'PAYMENT_FAILED'/);
 assert.ok(expiry.indexOf('notificationService.enqueueEvent')<expiry.indexOf('if(owns)await conn.commit()'));
});
test('all producer event types resolve to safe mandatory-capable projections',()=>{
 for(const type of ['DISPATCH_SCHEDULED','OUT_FOR_DELIVERY','DELIVERY_REPORTED','DELIVERY_DELAYED',
  'RECEIPT_CONFIRMED','DISPUTE_OPENED','PAYMENT_PENDING','PAYMENT_VERIFIED','PAYMENT_FAILED']){
  const p=eventProjection({eventType:type,entityId:70});
  assert.match(p.deepLink,/^\/(orders|profile|procurement)\?/);
  if(['DISPUTE_OPENED','PAYMENT_PENDING','PAYMENT_VERIFIED','PAYMENT_FAILED'].includes(type))
   assert.equal(p.mandatory,true,type+' must be mandatory');
 }
});
