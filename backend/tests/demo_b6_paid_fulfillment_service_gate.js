'use strict';
// Actual B6 award reconciliation and supplier fulfillment methods; isolated
// deterministic SQL adapter. Does not mark any external money as received.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const root=path.resolve(__dirname,'../src/services');
const exact=require('../src/services/exactDecimal');
function service(file,deps){
  const filename=path.join(root,file),m=new Module(filename,module);
  m.filename=filename;
  const source=fs.readFileSync(filename,'utf8');
  new Function('module','exports','require',source)(m,m.exports,id=>{
    if(id==='../config/db')return deps.db;
    if(id==='./exactDecimal')return exact;
    if(id==='./feeService')return {};
    if(id==='./procurementMatchingService')return {};
    if(id==='./procurementAwardPolicy')return {buildAwardPreview:()=>({})};
    if(id==='./reservationEventService')return {};
    if(id==='./supplierEligibilityPolicy')return {evaluateSupplierEligibility:()=>({eligible:true})};
    return require(id);
  });
  return m.exports;
}
async function main(){
  let passed=0;const check=(name,fn)=>{fn();console.log('PASS '+(++passed)+': '+name)};
  const states={101:'PAID',102:'PENDING'},updates=[];
  const conn={
    async query(sql,args){
      if(sql.includes('SELECT award_id FROM procurement_award_orders'))return [[{award_id:9}]];
      if(sql.includes('FROM procurement_awards WHERE id=? FOR UPDATE'))
        return [[{id:9,request_id:5,status:'AWAITING_PAYMENT'}]];
      if(sql.includes('SELECT ao.order_id,o.payment_status'))
        return [[{order_id:101,payment_status:states[101]},{order_id:102,payment_status:states[102]}]];
      if(sql.includes('UPDATE supplier_inventory_allocations')){updates.push({kind:'allocation',id:args[0]});return [{affectedRows:1}]}
      if(sql.includes('UPDATE procurement_awards')){updates.push({kind:'award',status:args[0]});return [{affectedRows:1}]}
      if(sql.includes('UPDATE procurement_requests')){updates.push({kind:'request',id:args[0]});return [{affectedRows:1}]}
      if(sql.includes('FROM users u')&&sql.includes('LEFT JOIN supplier_profiles sp'))
        return [[{id:args[0],role:'SUPPLIER',is_verified:1,verification_status:'VERIFIED',profile_verification_status:'VERIFIED'}]];
      const qualifying=[101,102].filter(id=>states[id]==='PAID'&&(id===101?11:12)===args[0]);
      if(sql.includes('SELECT COUNT(*) AS total')&&sql.includes('FROM orders o'))
        return [[{total:qualifying.length}]];
      if(sql.includes('FROM orders o')&&sql.includes('LEFT JOIN pools p'))
        return [qualifying.map(id=>({id,order_code:'B6-'+id,pool_id:null,buyer_id:4,
          supplier_id:id===101?11:12,total_qty:10,payment_status:'PAID',
          fulfillment_status:'AWAITING_SUPPLIER_ACKNOWLEDGEMENT',order_status:'PAID',created_at:new Date()}))];
      throw Error('Unexpected SQL: '+sql.slice(0,90));
    },release(){}
  };
  const db={getConnection:async()=>conn};
  const award=service('procurementAwardService.js',{db});
  const fulfillment=service('fulfillmentService.js',{db});
  const first=await award.reconcilePaidOrder(conn,101);
  check('first paid supplier award stays PARTIALLY_PAID',()=>{
    assert.equal(first.status,'PARTIALLY_PAID');
    assert.equal(first.paid_orders,1);
    assert.equal(first.total_orders,2);
    assert.equal(updates.filter(x=>x.kind==='allocation').length,1);
    assert.equal(updates.filter(x=>x.kind==='request').length,0);
  });
  const firstSupplier=await fulfillment.listSupplierFulfillmentOrders({actor:{id:11,role:'SUPPLIER'}});
  check('supplier 11 sees its paid poolless B6 order',()=>{
    assert.equal(firstSupplier.pagination.total,1);
    assert.equal(firstSupplier.orders[0].order_id,101);
    assert.equal(firstSupplier.orders[0].pool_id,null);
  });
  const secondBefore=await fulfillment.listSupplierFulfillmentOrders({actor:{id:12,role:'SUPPLIER'}});
  check('supplier 12 cannot see its unpaid B6 order',()=>{
    assert.equal(secondBefore.pagination.total,0);
    assert.equal(secondBefore.orders.length,0);
  });
  states[102]='PAID';
  const second=await award.reconcilePaidOrder(conn,102);
  const secondAfter=await fulfillment.listSupplierFulfillmentOrders({actor:{id:12,role:'SUPPLIER'}});
  check('second paid order finalizes award and becomes supplier-12 fulfillment',()=>{
    assert.equal(second.status,'PAID');
    assert.equal(second.paid_orders,2);
    assert.equal(secondAfter.orders[0].order_id,102);
    assert.ok(updates.some(x=>x.kind==='request'&&x.id===5));
    assert.deepEqual(updates.filter(x=>x.kind==='allocation').map(x=>x.id),[101,102]);
  });
  console.log('B6 PAID FULFILLMENT SERVICE: '+passed+'/'+passed+' PASS (mocked SQL only)');
}
main().catch(e=>{console.error(e);process.exitCode=1});
