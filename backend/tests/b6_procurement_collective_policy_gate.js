'use strict';
const assert=require('node:assert/strict');
const {aggregateCollectiveDemand}=require('../src/services/procurementCollectivePolicy');
let n=0;
const check=(name,condition)=>{assert.ok(condition,name);console.log('PASS '+(++n)+': '+name);};
const rejects=(code,fn)=>assert.throws(fn,e=>e.code===code);
const buyer=(buyer_id,items,status='JOINED')=>({
 buyer_id,status,consent_confirmed:true,lines:items
});
const rice=(quantity,supplier_sku_id=7,product_spec_id=11)=>({
 request_item_id:1,family_id:2,supplier_sku_id,product_spec_id,purchasing_unit:'bag',quantity
});
const sugar=(quantity)=>({
 request_item_id:2,family_id:4,supplier_sku_id:8,product_spec_id:12,purchasing_unit:'bag',quantity
});
const participants=[buyer(1,[rice('3'),sugar('2')]),
 buyer(2,[rice('4'),sugar('1')]),buyer(3,[rice('2')],'INVITED')];
const result=aggregateCollectiveDemand({participants});
check('Only actual joined businesses count',result.qualified_participant_count===2);
check('Two verified consented buyers meet group threshold',result.minimum_buyers_met===true);
check('Rice packs aggregate to seven',result.group_lines.find(x=>x.request_item_id===1).total_quantity==='7.0000');
check('Sugar packs remain separate',result.group_lines.find(x=>x.request_item_id===2).total_quantity==='3.0000');
check('Unaccepted invite excluded',result.group_lines.find(x=>x.request_item_id===1).buyer_count===2);
check('No payment commitment or buyer addresses in output',
 result.payment_authorized===false && !/"buyer_id"\s*:/.test(JSON.stringify(result)));
const mismatch=aggregateCollectiveDemand({participants:[
 buyer(1,[rice('3')]),buyer(2,[rice('4',9,15)])
]});
check('Different physical supplier SKUs never mixed',mismatch.group_lines.length===2);
const below=aggregateCollectiveDemand({participants:[buyer(1,[rice('2')])]});
check('Group with one confirmed buyer not qualified',below.minimum_buyers_met===false);
rejects('BUYER_CONSENT_REQUIRED',()=>aggregateCollectiveDemand({participants:[
 buyer(1,[rice('2')]),{...buyer(2,[rice('2')]),consent_confirmed:false}]}));
check('Participant without explicit consent rejected',true);
rejects('DUPLICATE_COLLECTIVE_BUYER',()=>aggregateCollectiveDemand({participants:[
 buyer(1,[rice('1')]),buyer(1,[rice('1')])]}));
check('Duplicate buyer rejected',true);
rejects('DUPLICATE_COLLECTIVE_LINE',()=>aggregateCollectiveDemand({participants:[
 buyer(1,[rice('1'),rice('2')])]}));
check('Duplicate buyer item rejected',true);
rejects('INVALID_COLLECTIVE_QUANTITY',()=>aggregateCollectiveDemand({participants:[
 buyer(1,[rice('1.5')])]}));
check('Fractional sealed packaging rejected',true);
rejects('INVALID_COLLECTIVE_UNIT',()=>aggregateCollectiveDemand({participants:[
 buyer(1,[{...rice('1'),purchasing_unit:'ton'}])]}));
check('Unsupported units rejected',true);
console.log('B6 COLLECTIVE POLICY: '+n+'/'+n+' PASS (pure eligibility only)');
