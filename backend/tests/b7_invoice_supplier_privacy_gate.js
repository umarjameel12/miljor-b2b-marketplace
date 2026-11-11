'use strict';
const assert=require('node:assert/strict');
const {projectInvoiceForActor}=require('../src/services/b7InvoiceAudienceProjection');
let n=0;const pass=(label,fn)=>{fn();console.log('PASS '+(++n)+': '+label)};
const stored={id:9,order_id:91,total_amount:'9400.00',
 invoice_snapshot_json:JSON.stringify({
  invoice_number:'INV-2026-000091',
  buyer:{id:5,business_name:'Lahore Catering',
   email:'private@buyer.test',phone:'03001234567',delivery_address:'Private home address'},
  supplier:{id:2,business_name:'MilJor Test Wholesale'},
  items:[{description:'Rice 100 kg',quantity:'100.0000',line_total:'8000.00'}],
  pricing:{total_amount:9400,delivery_fee:150}
 })};
pass('Authorized supplier receives correct order and financial totals',()=>{
 const invoice=projectInvoiceForActor(stored,'SUPPLIER');
 assert.equal(invoice.order_id,91);
 assert.equal(invoice.invoice_snapshot_json.pricing.total_amount,9400);
 assert.equal(invoice.invoice_snapshot_json.items.length,1);
});
pass('Supplier invoice excludes buyer email phone and delivery address',()=>{
 const buyer=projectInvoiceForActor(stored,'SUPPLIER').invoice_snapshot_json.buyer;
 assert.equal(Object.hasOwn(buyer,'email'),false);
 assert.equal(Object.hasOwn(buyer,'phone'),false);
 assert.equal(Object.hasOwn(buyer,'delivery_address'),false);
 assert.equal(buyer.business_name,'Lahore Catering');
});
pass('Stored financial invoice is unchanged by audience projection',()=>{
 assert.equal(typeof stored.invoice_snapshot_json,'string');
 assert.ok(stored.invoice_snapshot_json.includes('private@buyer.test'));
});
pass('Authorized buyer retains original invoice accounting snapshot',()=>{
 assert.equal(projectInvoiceForActor(stored,'BUYER'),stored);
});
pass('Invoice JSON object projection is supported',()=>{
 const invoice=projectInvoiceForActor({
  ...stored,invoice_snapshot_json:JSON.parse(stored.invoice_snapshot_json)
 },'SUPPLIER');
 assert.equal(invoice.invoice_snapshot_json.buyer.email,undefined);
});
pass('Malformed invoice snapshot fails closed to supplier',()=>{
 assert.throws(()=>projectInvoiceForActor({...stored,invoice_snapshot_json:'{bad'},'SUPPLIER'),
  e=>e.code==='INVOICE_SNAPSHOT_INVALID');
});
console.log('B7 INVOICE AUDIENCE PRIVACY: '+n+'/'+n+' PASS');
