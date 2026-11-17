'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {compatibleRun,measureLines,normalizeWindow}=require('../src/services/procurementDeliveryRunPolicy');
const choice=(order,id=1)=>({order_id:order,supplier_id:7,cluster_id:id,delivery_day:'2026-12-01',delivery_window:'09:00-12:00',mode:'STANDARD_CLUSTERED',handling_class:'AMBIENT',locked_delivery_fee:'25.00'});
test('route compatibility uses real measures and exact cost shares',()=>{
 const measurements=measureLines([{quantity:'2',purchasing_unit:'bag',pack_size:'25',pack_unit:'kg'}]);assert.deepEqual(measurements,{weight_kg:'50.0000',volume_l:'0.0000'});
 const result=compatibleRun([choice(11),{...choice(12),delivery_window:'10:00-13:00'}],[measurements,measurements],{max_weight_kg:'100',max_volume_l:'0',planned_cost_pkr:'40'});
 assert.equal(result.delivery_window,'10:00-12:00');assert.equal(result.locked_fee_total,'50.00');assert.equal(result.allocations.reduce((v,x)=>v+Number(x.cost_share),0),40);
});
test('rejects incompatible route, impossible capacity, non-cheaper and unknown physical units',()=>{
 const measure={weight_kg:'1.0000',volume_l:'0.0000'},input={max_weight_kg:'2',max_volume_l:'0',planned_cost_pkr:'40'};
 for(const other of [{...choice(12),cluster_id:2},{...choice(12),supplier_id:8},{...choice(12),delivery_window:'13:00-14:00'},{...choice(12),handling_class:'CHILLED'}])assert.throws(()=>compatibleRun([choice(11),other],[measure,measure],input));
 assert.throws(()=>compatibleRun([choice(11),choice(12)],[measure,measure],{...input,max_weight_kg:'1'}));
 assert.throws(()=>compatibleRun([choice(11),choice(12)],[measure,measure],{...input,planned_cost_pkr:'50'}));
 assert.throws(()=>measureLines([{quantity:'1',purchasing_unit:'pack',pack_size:'1',pack_unit:'unknown'}]));
 assert.throws(()=>normalizeWindow('12:00-10:00'));
});
