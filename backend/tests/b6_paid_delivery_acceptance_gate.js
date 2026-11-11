'use strict';
// B6-O paid order delivery acceptance, mock-DB safety gate. No live MySQL.
const assert=require('node:assert/strict');
const {ProcurementDeliveryGroupingService}=require('../src/services/procurementDeliveryGroupingService');
const notifications=require('../src/services/procurementNotificationService');
let passCount=0;
const pass=(name,good)=>{assert.ok(good,name);console.log('PASS '+(++passCount)+' '+name)};
const safeKey='delivery-o-test-0001';
const state={paid:true,destination:'123 Model Town Road',
 address:'123 model town road',fee:'125.00',saved:null,writes:0,notices:[],
 express:false,pickup:false};
const order=()=>({id:71,buyer_id:11,supplier_id:23,
 delivery_type:'GROUPED_CLUSTER',
 delivery_address:state.destination,cluster_zone:'Model Town',
 payment_status:state.paid?'PAID':'AWAITING_PAYMENT',
 fulfillment_status:state.paid?'PREPARING':'UNPAID',
 delivery_fee:state.fee});
const conn={
 async beginTransaction(){},async commit(){},async rollback(){},release(){},
 async query(sql,args=[]){
  if(sql.includes('FROM orders WHERE id=? AND buyer_id=?'))
   return [args[0]===71&&args[1]===11?[order()]:[]];
  if(sql.includes('FROM procurement_order_delivery_choices WHERE order_id=? FOR UPDATE'))
   return [state.saved?[state.saved]:[]];
  if(sql.includes('FROM buyer_delivery_addresses a JOIN geographic_clusters'))
   return [[{id:12,user_id:11,cluster_id:5,revision:2,city:'Lahore',
    full_address:state.address,user_confirmation_status:'CONFIRMED',
    geographic_match_status:'VERIFIED',cluster_active:1}]];
  if(sql.includes('FROM supplier_delivery_configurations WHERE supplier_id=?'))
   return [[{supplier_id:23,standard_delivery_enabled:1,
    pickup_enabled:1,express_enabled:1,version:2}]];
  if(sql.includes('FROM supplier_delivery_cluster_rates WHERE supplier_id=?'))
   return [[{id:1}]];
  if(sql.includes('FROM delivery_quotes WHERE buyer_id=?'))return [[{id:99}]];
  if(sql.includes('INSERT INTO procurement_order_delivery_choices')){
   state.writes++;
   state.saved={acceptance_key:args[12],acceptance_hash:args[13]};
   return [{insertId:state.writes}];
  }
  throw Error('Unrecognized acceptance SQL: '+sql);
 }
};
const db={
 async getConnection(){return conn},
 async query(sql,args=[]){
  if(sql.includes('FROM orders WHERE id=? AND buyer_id=?'))
   return [args[0]===71&&args[1]===11?[order()]:[]];
  if(sql.includes('FROM supplier_delivery_configurations WHERE supplier_id=?'))
   return [[{standard_delivery_enabled:1,pickup_enabled:1,
    express_enabled:1,version:2}]];
  throw Error('Unexpected preview SQL: '+sql);
 }
};
const input=(extras={})=>({address_id:12,delivery_day:'2030-01-02',
 delivery_window:'09:00-12:00',handling_class:'AMBIENT',
 mode:'STANDARD_CLUSTERED',accepted_delivery_fee:'125.00',
 confirm_existing_order_delivery_fee:true,...extras});
async function main(){
 const original=notifications.enqueue;
 notifications.enqueue=async(_,event)=>{state.notices.push(event);return {notification_id:1}};
 try{
  const service=new ProcurementDeliveryGroupingService(db);
  const preview=await service.previewBuyerDelivery(11,71);
  pass('Locked delivery fee comes from real paid order',preview.locked_delivery_fee==='125.00');
  await assert.rejects(()=>service.previewBuyerDelivery(12,71),e=>e.code==='ORDER_NOT_FOUND');
  pass('Other buyer cannot view order delivery terms',true);
  await assert.rejects(()=>service.acceptBuyerDelivery(11,71,
   input({accepted_delivery_fee:'124.00'}),safeKey),
   e=>e.code==='DELIVERY_FEE_REAPPROVAL_REQUIRED');
  pass('Payment fee alteration rejected before any mutation',state.writes===0);
  state.address='Unknown alternate street';
  await assert.rejects(()=>service.acceptBuyerDelivery(11,71,input(),safeKey),
   e=>e.code==='PAID_DESTINATION_BINDING_REQUIRED');
  pass('Unrelated address cannot replace paid destination',state.writes===0);
  state.address='123 model town road';
  await assert.rejects(()=>service.acceptBuyerDelivery(11,71,
   input({mode:'EXPRESS'}),safeKey),e=>e.code==='EXPRESS_ORDER_BINDING_REQUIRED');
  pass('Express without exact paid-order binding rejected',state.writes===0);
  await assert.rejects(()=>service.acceptBuyerDelivery(11,71,
   input({mode:'PICKUP'}),safeKey),e=>
   ['DELIVERY_MODE_CHANGED','PICKUP_USE_EXISTING_FULFILLMENT'].includes(e.code));
  pass('Pickup cannot silently replace paid doorstep delivery',state.writes===0);
  state.paid=false;
  await assert.rejects(()=>service.acceptBuyerDelivery(11,71,input(),safeKey),
   e=>e.code==='ORDER_NOT_ELIGIBLE');
  pass('Unpaid order cannot be added to delivery run',state.writes===0);
  state.paid=true;
  const saved=await service.acceptBuyerDelivery(11,71,input(),safeKey);
  pass('Exact paid order and address can be accepted',saved.status==='AUTHORIZED'&&!saved.creates_payment);
  pass('Exactly one acceptance row created',state.writes===1);
  pass('Buyer-only notification emitted',state.notices.length===1&&
    state.notices[0].recipient_id===11);
  const replay=await service.acceptBuyerDelivery(11,71,input(),safeKey);
  pass('Same accepted delivery replay is idempotent',replay.is_replay===true&&state.writes===1);
  console.log('B6-O PAID DELIVERY ACCEPTANCE: '+passCount+'/'+passCount+' PASS');
 }finally{notifications.enqueue=original}
}
main().then(()=>process.exit(0)).catch(e=>{console.error('B6-O DELIVERY ACCEPTANCE FAIL',e);process.exitCode=1});
