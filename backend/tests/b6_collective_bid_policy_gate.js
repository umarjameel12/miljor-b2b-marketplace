'use strict';
// Pure exact-policy checks; no database or gateway is contacted.
const assert=require('node:assert/strict');
const {buildCollectiveBidPreview}=require('../src/services/procurementCollectiveBidPolicy');
let passed=0;
const run=(label,fn)=>{fn();console.log('PASS '+(++passed)+': '+label)};
const fails=(code,fn)=>assert.throws(fn,e=>e.code===code);
const physical={supplier_sku_id:11,product_spec_id:12,family_id:1,
 purchasing_unit:'bag',brand:'Wholesale rice',quality_grade:'A',pack_size:'25',pack_unit:'kg'};
const req=[{id:101,family_id:1,unit:'bag',requirements:'25kg export quality'},
 {id:102,family_id:2,unit:'tin',requirements:'16L cooking oil'}];
const buyer=(buyer_id,rice,oil,status='JOINED')=>({
 buyer_id,status,consent_confirmed:true,lines:[
  {request_item_id:101,quantity:String(rice),unit:'bag'},
  {request_item_id:102,quantity:String(oil),unit:'tin'}
 ]});
const buyers=[buyer(3,2,1),buyer(4,3,2)];
const bid=[
 {request_item_id:101,supplier_listing_id:11,min_aggregate_quantity:'5',
  unit_price:'250.00',physical_snapshot:physical},
 {request_item_id:102,supplier_listing_id:22,min_aggregate_quantity:'3',
  unit_price:'600.00',physical_snapshot:{...physical,supplier_sku_id:24,
   product_spec_id:25,family_id:2,purchasing_unit:'tin',pack_size:'16',pack_unit:'l'}}
];
const options={requestItems:req,participants:buyers,supplierLines:bid,
 minimumBuyers:2,deliveryFeePerBuyer:'125.00'};
const p=buildCollectiveBidPreview(options);
run('Two independently consenting buyers qualify',()=>assert.equal(p.qualified_buyers,2));
run('Rice quantity 2 + 3 = 5 bags',()=>assert.equal(p.lines[0].aggregate_quantity,'5.0000'));
run('Oil quantity 1 + 2 = 3 tins, NOT mixed with rice',()=>assert.equal(p.lines[1].aggregate_quantity,'3.0000'));
run('Exact rice total',()=>assert.equal(p.lines[0].subtotal,'1250.00'));
run('Exact oil total',()=>assert.equal(p.lines[1].subtotal,'1800.00'));
run('Supplier delivery charged per individual buyer',()=>{
 assert.equal(p.buyers[0].supplier_quoted_total,'1225.00');
 assert.equal(p.buyers[1].supplier_quoted_total,'2075.00');
});
run('No stock or financial side effect',()=>{
 assert.equal(p.payment_authorized,false);assert.equal(p.inventory_reserved,false);
 assert.ok(p.buyers.every(x=>x.authorizes_payment===false));
});
run('No buyer consent means no collective qualification',()=>fails('COLLECTIVE_NOT_QUALIFIED',
 ()=>buildCollectiveBidPreview({...options,participants:[buyers[0],{...buyers[1],status:'INVITED'}]})));
run('Unconsented JOINED participant rejected',()=>fails('UNCONSENTED_PARTICIPANT',
 ()=>buildCollectiveBidPreview({...options,participants:[buyers[0],{...buyers[1],consent_confirmed:false}]})));
run('Supplier threshold must be reached',()=>fails('COLLECTIVE_THRESHOLD_UNMET',
 ()=>buildCollectiveBidPreview({...options,supplierLines:[{...bid[0],min_aggregate_quantity:'6'}]})));
run('Rice as tin is a SKU mismatch',()=>fails('PHYSICAL_SPEC_MISMATCH',
 ()=>buildCollectiveBidPreview({...options,supplierLines:[{...bid[0],physical_snapshot:{...physical,purchasing_unit:'tin'}}]})));
run('A duplicate buyer is rejected',()=>fails('DUPLICATE_PARTICIPANT',
 ()=>buildCollectiveBidPreview({...options,participants:[buyers[0],buyers[0]]})));
run('Fractional physical packages rejected',()=>fails('INVALID_COLLECTIVE_QUANTITY',
 ()=>buildCollectiveBidPreview({...options,participants:[buyer(3,'1.5',1),buyers[1]]})));
run('Negative supplier bid price rejected',()=>fails('INVALID_COLLECTIVE_PRICE',
 ()=>buildCollectiveBidPreview({...options,supplierLines:[{...bid[0],unit_price:'-1'}]})));
run('Partial offer explicitly displayed as partial',()=>{
 const x=buildCollectiveBidPreview({...options,supplierLines:[bid[0]]});
 assert.equal(x.coverage,'PARTIAL');
 assert.ok(x.buyers.every(y=>!y.all_lines_covered));
});
run('Duplicated supplier line fails closed',()=>fails('INVALID_BID_ITEM',
 ()=>buildCollectiveBidPreview({...options,supplierLines:[bid[0],bid[0]]})));
console.log('B6 COLLECTIVE BID POLICY: '+passed+'/'+passed+' PASS');
