'use strict';
const assert=require('node:assert/strict');
const {planSupplierDeliveryGroups}=require('../src/services/procurementDeliveryGroupPolicy');
let count=0;const run=(label,fn)=>{fn();console.log('PASS '+(++count)+' '+label)};
const rejected=(code,fn)=>assert.throws(fn,e=>e.code===code);
const base=(id,overrides={})=>({id,supplier_id:7,buyer_id:id+100,cluster_id:4,
 delivery_day:'2026-11-19',delivery_window:'09:00-12:00',handling_class:'AMBIENT',
 delivery_address_id:id+1000,mode:'STANDARD_CLUSTERED',payment_status:'PAID',
 fulfillment_status:'PREPARING',delivery_authorized:true,
 supplier_standard_enabled:true,cluster_supported:true,locked_delivery_fee:'100.00',
 ...overrides});
const first=planSupplierDeliveryGroups([base(1),base(2)]);
run('Same supplier/cluster/day gives one grouping',()=>assert.equal(first.groups.length,1));
run('Both paid stops preserved',()=>assert.equal(first.groups[0].stops.length,2));
run('Delivery fee remains exact Rs200',()=>assert.equal(first.groups[0].total_locked_delivery_fee,'200.00'));
run('Different supplier cannot share a run',()=>assert.equal(planSupplierDeliveryGroups([base(1),base(2,{supplier_id:8})]).groups.length,2));
run('Different cluster cannot share a run',()=>assert.equal(planSupplierDeliveryGroups([base(1),base(2,{cluster_id:5})]).groups.length,2));
run('Different delivery dates cannot share',()=>assert.equal(planSupplierDeliveryGroups([base(1),base(2,{delivery_day:'2026-11-20'})]).groups.length,2));
run('Different delivery window cannot share',()=>assert.equal(planSupplierDeliveryGroups([base(1),base(2,{delivery_window:'12:00-16:00'})]).groups.length,2));
run('Handling requirements cannot be mixed',()=>assert.equal(planSupplierDeliveryGroups([base(1),base(2,{handling_class:'CHILLED'})]).groups.length,2));
run('Unpaid order excluded',()=>assert.equal(planSupplierDeliveryGroups([base(1,{payment_status:'UNPAID'})]).groups.length,0));
run('Unverified delivery fee fails closed',()=>rejected('DELIVERY_NOT_APPROVED',()=>planSupplierDeliveryGroups([base(1,{delivery_authorized:false})])));
run('Express not offered fails closed',()=>rejected('EXPRESS_NOT_CONFIGURED',()=>planSupplierDeliveryGroups([base(1,{mode:'EXPRESS'})])));
run('Pickup not offered fails closed',()=>rejected('PICKUP_NOT_CONFIGURED',()=>planSupplierDeliveryGroups([base(1,{mode:'PICKUP'})])));
run('Unsupported cluster fails closed',()=>rejected('CLUSTER_NOT_SUPPORTED',()=>planSupplierDeliveryGroups([base(1,{cluster_supported:false})])));
run('Duplicate order cannot be grouped twice',()=>rejected('DUPLICATE_DELIVERY_ORDER',()=>planSupplierDeliveryGroups([base(1),base(1)])));
run('No fees change or payment is created',()=>assert.ok(!first.changes_order_fees&&!first.creates_payments));
run('Invalid stop ceiling rejected',()=>rejected('INVALID_MAX_STOPS',()=>planSupplierDeliveryGroups([base(1)],{maxStops:0})));
console.log('B6-O POLICY: '+count+'/'+count+' PASS');
