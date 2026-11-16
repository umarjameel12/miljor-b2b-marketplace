'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const policy=require('../src/services/procurementLineReceiptPolicy');
const line={id:1,quantity:'100.0000',purchasing_unit:'bag',unit_price:'123.45',subtotal:'12345.00',immutable_sku_snapshot:{}};
const claim={award_line_id:1,received_quantity:'80',accepted_quantity:'80',disputed_quantity:'20',reason:'QUANTITY_MISMATCH',evidence_notes:'Twenty bags missing'};
test('100/80/20 has exact line-scoped assessment, no fee entitlement',()=>{
 const result=policy.assessLine(line,claim);
 assert.equal(result.disputed_quantity,'20.0000');
 assert.equal(result.short_quantity,'20.0000');
 assert.equal(result.refund_assessment_amount,'2469.00');
 assert.equal(result.hold_assessment_amount,'2469.00');
 assert.equal(result.fee_refund_assessment_amount,'0.00');
});
test('received damaged units count once alongside missing units',()=>{
 const result=policy.assessLine(line,{...claim,received_quantity:'90',accepted_quantity:'80'});
 assert.equal(result.short_quantity,'10.0000');assert.equal(result.rejected_quantity,'10.0000');
 assert.equal(result.disputed_quantity,'20.0000');
});
test('whole packages and quantity conservation fail closed',()=>{
 for(const patch of [{received_quantity:'101'},{accepted_quantity:'81'},
  {received_quantity:'80.5'},{disputed_quantity:'19'}, {received_quantity:'1e2'},
  {accepted_quantity:null},{reason:null},{received_quantity:true}])
  assert.throws(()=>policy.assessLine(line,{...claim,...patch}));
});
test('loose unit immutable increment enforced; unknown units blocked',()=>{
 const loose={...line,purchasing_unit:'kg',immutable_sku_snapshot:{step_size:'0.25'}};
 assert.equal(policy.assessLine(loose,{...claim,received_quantity:'80.25'}).rejected_quantity,'0.2500');
 assert.throws(()=>policy.assessLine(loose,{...claim,received_quantity:'80.1'}));
 assert.throws(()=>policy.assessLine({...loose,immutable_sku_snapshot:{}},claim),{code:'RECEIPT_INCREMENT_SNAPSHOT_REQUIRED'});
 assert.throws(()=>policy.assessLine({...line,purchasing_unit:'unknown'},claim));
});
test('rounded partial amount never exceeds immutable line subtotal',()=>{
 const tiny={...line,quantity:'3',unit_price:'0.01',subtotal:'0.03'};
 assert.equal(policy.assessLine(tiny,{...claim,received_quantity:'0',accepted_quantity:'0',disputed_quantity:'3'}).refund_assessment_amount,'0.03');
 assert.throws(()=>policy.assessLine({...line,subtotal:'1.00'},claim),{code:'AWARD_LINE_PRICE_INTEGRITY_ERROR'});
});
test('full accepted receipt has zero dispute and needs no reason',()=>{
 const result=policy.assessLine(line,{award_line_id:1,received_quantity:'100',accepted_quantity:'100',disputed_quantity:'0'});
 assert.equal(result.refund_assessment_amount,'0.00');
});
test('canonical payload stable for reordered lines; duplicate and extra fields rejected',()=>{
 const a=policy.normalizeSubmission({lines:[claim,{...claim,award_line_id:2}]});
 const b=policy.normalizeSubmission({lines:[{...claim,award_line_id:2},claim]});
 assert.deepEqual(a,b);
 assert.throws(()=>policy.normalizeSubmission({lines:[claim,claim]}));
 assert.throws(()=>policy.normalizeSubmission({lines:[{...claim,refund_amount:'999'}]}));
});
test('accepted-merchandise commission and all contested fees conserve captured funds',()=>{
 const assessment=policy.assessFinancialAllocation({subtotal_amount:'1000.00',delivery_fee:'50.00',buyer_platform_fee:'20.00',total_amount:'1070.00',supplier_commission_percent:'2.50'},
  '1070.00',[{subtotal:'1000.00',refund_assessment_amount:'200.00'}]);
 assert.equal(assessment.accepted_merchandise_amount,'800.00');
 assert.equal(assessment.accepted_commission_amount,'20.00');
 assert.equal(assessment.accepted_supplier_net,'780.00');
 assert.equal(assessment.disputed_merchandise_hold,'200.00');
 assert.equal(assessment.delivery_fee_hold,'50.00');assert.equal(assessment.processing_fee_hold,'20.00');
 assert.equal(assessment.allocated_captured_amount,'1070.00');
});
test('zero accepted merchandise earns no commission; missing rate and capture mismatch block',()=>{
 const order={subtotal_amount:'1000',delivery_fee:'50',buyer_platform_fee:'20',total_amount:'1070',supplier_commission_percent:'2.50'};
 const lines=[{subtotal:'1000',refund_assessment_amount:'1000'}];
 assert.equal(policy.assessFinancialAllocation(order,'1070',lines).accepted_commission_amount,'0.00');
 assert.throws(()=>policy.assessFinancialAllocation({...order,supplier_commission_percent:null},'1070',lines));
 assert.throws(()=>policy.assessFinancialAllocation(order,'1069',lines));
 assert.throws(()=>policy.assessFinancialAllocation(order,'1070',[{subtotal:'1000',refund_assessment_amount:'1001'}]));
});
test('fee policy requires explicit current version acceptance',()=>{
 assert.throws(()=>policy.assertFeePolicyConsent(null));
 assert.throws(()=>policy.assertFeePolicyConsent({version:policy.FEE_POLICY_VERSION,accepted:false}));
 assert.throws(()=>policy.assertFeePolicyConsent({version:'older',accepted:true}));
 assert.equal(policy.assertFeePolicyConsent({version:policy.FEE_POLICY_VERSION,accepted:true}).accepted,true);
});
test('fractional cent split allocates accepted value first and conserves immutable subtotal',()=>{
 const line={id:1,quantity:'0.0100',purchasing_unit:'kg',unit_price:'1.00',subtotal:'0.01',immutable_sku_snapshot:{step_size:'0.0001'}};
 const result=policy.assessLine(line,{award_line_id:1,received_quantity:'0.0050',accepted_quantity:'0.0050',disputed_quantity:'0.0050',reason:'QUANTITY_MISMATCH',evidence_notes:'half missing'});
 assert.equal(result.accepted_merchandise_amount,'0.01');assert.equal(result.refund_assessment_amount,'0.00');
});
