'use strict';
const assert=require('node:assert/strict');
const {ProcurementDeliveryOptionsService}=require('../src/services/procurementDeliveryOptionsService');
const row={id:20,supplier_id:200,status:'ACTIVE',current_version:3,
  request_status:'OPEN',valid_until:new Date(Date.now()+3600000).toISOString(),
  delivery_fee:'250.00',delivery_lead_days:2};
let captured=null;
const database={query:async(sql,args)=>[[...(
  args[0]===10&&args[1]===100&&args[2]===20?[row]:[]
)]]};
const eligible={getDeliveryOptions:async(buyer,args)=>{
  captured={buyer,args};return {buyer_cluster:{id:5,name:'Johar Town'},
    eligible_modes:[{mode:'STANDARD_CLUSTERED',price_pkr:250}],
    ineligible_modes:[{mode:'EXPRESS',reason_code:'MODE_DISABLED_BY_SUPPLIER'}],
    supplier_config_version:4};
}};
const svc=new ProcurementDeliveryOptionsService(database,eligible);
const rejected=async(fn,code)=>assert.rejects(fn,e=>e.code===code);
(async()=>{
  const result=await svc.forBuyer(100,10,20,5);
  assert.deepEqual(captured,{buyer:100,args:{supplier_id:200,cluster_id:5}});
  assert.equal(result.quote_version,3);
  assert.equal(result.current_quote_delivery_fee,'250.00');
  assert.equal(result.mode_selection_binding_enabled,false);
  assert.equal(result.eligible_modes[0].mode,'STANDARD_CLUSTERED');
  await rejected(()=>svc.forBuyer(101,10,20,5),'QUOTE_NOT_FOUND');
  await rejected(()=>svc.forBuyer(100,10,20,'bad'),'INVALID_DELIVERY_ID');
  const unavailable=new ProcurementDeliveryOptionsService({
    query:async()=>[[{...row,status:'WITHDRAWN'}]]},eligible);
  await rejected(()=>unavailable.forBuyer(100,10,20,5),'QUOTE_NOT_AVAILABLE');
  const expired=new ProcurementDeliveryOptionsService({
    query:async()=>[[{...row,valid_until:new Date(Date.now()-3600000).toISOString()}]]},eligible);
  await rejected(()=>expired.forBuyer(100,10,20,5),'QUOTE_EXPIRED');
  console.log('SMART_HUB_DELIVERY_OPTIONS_POLICY_PASS');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>require('../src/config/db').end().catch(()=>{}));
