'use strict';
const assert=require('node:assert/strict');
const {supplierDisputeRow,supplierDisputeTimeline}=require('../src/services/b7DisputeSupplierPrivacy');
let n=0;
const test=(label,fn)=>{fn();console.log('PASS '+(++n)+': '+label)};
const row={
 id:5,dispute_code:'DSP-ORD-91-test',order_id:91,supplier_id:2,
 order_code:'MJQ-TEST',dispute_category:'SHORT_QUANTITY',
 claimed_amount:'1600.00',disputed_quantity:'20.0000',currency:'PKR',
 status:'OPEN',remediation_status:'PROPOSED',description:'20 kg missing',
 buyer_id:5,buyer_name:'Private Buyer',buyer_email:'private@example.test',
 buyer_phone:'03001234567',delivery_address:'Private delivery address',
 evidence_metadata:JSON.stringify({phone:'private contact'}),
 evidence_image_url:'https://example.test/private.jpg',arbitrary_secret:'do not expose'
};
test('Supplier sees necessary claim quantity and price',()=>{
 const r=supplierDisputeRow(row);
 assert.equal(r.disputed_quantity,'20.0000');
 assert.equal(r.claimed_amount,'1600.00');
});
test('Supplier sees state required for remediation',()=>{
 const r=supplierDisputeRow(row);
 assert.equal(r.status,'OPEN');assert.equal(r.remediation_status,'PROPOSED');
});
test('Supplier cannot see buyer name/email/phone/address',()=>{
 const r=supplierDisputeRow(row);
 for(const k of ['buyer_id','buyer_name','buyer_email','buyer_phone','delivery_address'])
  assert.equal(Object.hasOwn(r,k),false,k);
});
test('Supplier cannot see evidence attachments or arbitrary database fields',()=>{
 const r=supplierDisputeRow(row);
 for(const k of ['evidence_metadata','evidence_image_url','arbitrary_secret'])
  assert.equal(Object.hasOwn(r,k),false,k);
});
test('Supplier timeline reveals status/actions but not arbitrary metadata/notes',()=>{
 const rows=supplierDisputeTimeline([{
  id:1,event_code:'E-1',from_status:'OPEN',to_status:'UNDER_REVIEW',
  action:'BUYER_FILED_DISPUTE',actor_role:'BUYER',created_at:'2026-11-11T00:00:00Z',
  notes:'private buyer number',metadata:{buyer_phone:'030000'}
 }]);
 assert.equal(rows[0].action,'BUYER_FILED_DISPUTE');
 assert.equal(Object.hasOwn(rows[0],'notes'),false);
 assert.equal(Object.hasOwn(rows[0],'metadata'),false);
});
test('Future DB fields do not automatically leak to supplier',()=>{
 const r=supplierDisputeRow({...row,identity_document:'secret',jwt:'secret'});
 assert.equal(Object.hasOwn(r,'identity_document'),false);
 assert.equal(Object.hasOwn(r,'jwt'),false);
});
console.log('B7 SUPPLIER DISPUTE PII SOURCE: '+n+'/'+n+' PASS');
