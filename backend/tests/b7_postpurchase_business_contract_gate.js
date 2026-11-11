'use strict';
const assert=require('node:assert/strict');
const {shortageForAwardLine}=require('../src/services/b7LineDeliveryPolicy');
const {buildAwardInvoiceLines}=require('../src/services/b7AwardInvoiceProjection');
let n=0;
const pass=(name,fn)=>{fn();console.log('PASS '+(++n)+': '+name)};
const bad=(code,fn)=>assert.throws(fn,e=>e.code===code);
const base={subtotal_amount:'9200.00',delivery_fee:'150.00',buyer_platform_fee:'50.00',total_amount:'9400.00'};
const rows=[
 {id:1,request_item_id:11,supplier_sku_id:101,purchasing_unit:'kg',
  quantity:'100',unit_price:'80.00',subtotal:'8000.00',
  immutable_sku_snapshot:JSON.stringify({title:'Rice Grade A'})},
 {id:2,request_item_id:12,supplier_sku_id:102,purchasing_unit:'tin',
  quantity:'2',unit_price:'600.00',subtotal:'1200.00',
  immutable_sku_snapshot:JSON.stringify({title:'Oil 16L'})}
];
pass('100kg ordered, 80kg received yields 20kg shortage',()=>{
 const x=shortageForAwardLine({ordered_quantity:'100',received_quantity:'80',locked_unit_price:'80.00'});
 assert.equal(x.disputed_quantity,'20.0000');
 assert.equal(x.claimed_amount,'1600.00');
});
pass('Exact decimal shortage preserved',()=>{
 const x=shortageForAwardLine({ordered_quantity:'1.2500',received_quantity:'0.2501',locked_unit_price:'10.00'});
 assert.equal(x.disputed_quantity,'0.9999');
});
pass('Over-received physical quantity rejected',()=>bad('RECEIVED_QUANTITY_OUT_OF_RANGE',
 ()=>shortageForAwardLine({ordered_quantity:'100',received_quantity:'101',locked_unit_price:'80'})));
pass('No missing quantity not disputable',()=>bad('NO_SHORT_DELIVERY',
 ()=>shortageForAwardLine({ordered_quantity:'100',received_quantity:'100',locked_unit_price:'80'})));
pass('Negative received quantity rejected',()=>bad('INVALID_LINE_QUANTITY',
 ()=>shortageForAwardLine({ordered_quantity:'100',received_quantity:'-1',locked_unit_price:'80'})));
pass('Physical quantities of unlike SKU and units remain separate',()=>{
 const items=buildAwardInvoiceLines(base,rows);
 assert.equal(items.length,2);
 assert.equal(items[0].quantity,'100.0000');
 assert.equal(items[1].unit,'tin');
 assert.equal(items[0].description,'Rice Grade A');
});
pass('Split supplier order cannot be described as one generic commodity',()=>{
 const items=buildAwardInvoiceLines(base,rows);
 assert.equal(items.map(x=>x.line_total).join(','),'8000.00,1200.00');
});
pass('Invoice subtotal mismatch fails closed',()=>bad('AWARD_INVOICE_SUBTOTAL_MISMATCH',
 ()=>buildAwardInvoiceLines({...base,subtotal_amount:'9201.00'},rows)));
pass('Invoice total mismatch fails closed',()=>bad('AWARD_INVOICE_TOTAL_MISMATCH',
 ()=>buildAwardInvoiceLines({...base,total_amount:'9399.00'},rows)));
pass('Missing award lines fails closed',()=>bad('AWARD_INVOICE_LINES_MISSING',
 ()=>buildAwardInvoiceLines(base,[])));
pass('Duplicate award line IDs rejected',()=>bad('AWARD_INVOICE_DUPLICATE_LINE',
 ()=>buildAwardInvoiceLines(base,[rows[0],rows[0]])));
pass('Invalid supplier SKU snapshot rejected',()=>bad('AWARD_INVOICE_SKU_SNAPSHOT',
 ()=>buildAwardInvoiceLines(base,[{...rows[0],immutable_sku_snapshot:'{oops'}])));
console.log('B7 BUSINESS CONTRACT SOURCE: '+n+'/'+n+' PASS');
