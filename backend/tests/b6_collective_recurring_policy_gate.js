'use strict';
const assert=require('node:assert/strict');
const {previewRecurringCollective,isCompatibleSchedule}=require('../src/services/procurementCollectiveRecurringPolicy');
let n=0;const check=(label,fn)=>{fn();console.log('PASS '+(++n)+' '+label)};
const throws=(code,fn)=>assert.throws(fn,e=>e.code===code);
const contract=(id,status='ACTIVE')=>({id,status,cadence:'WEEKLY',weekday_number:1,timezone_name:'Asia/Karachi',
 local_run_time:'09:00',starts_on:'2026-11-01',ends_on:null,
 payment_policy:'EXPLICIT_PER_CYCLE',pricing_policy:'REQUOTE_EACH_CYCLE'});
const member=(id,qty='1',cycle='SCHEDULED')=>({buyer_id:id,status:'CONSENTED',
 contract:contract(id+20),cycle_status:cycle,items:[{family_id:1,unit:'bag',quantity:qty,
 requirements:'Grade A 25kg',allow_substitutions:false}]});
const input={organizerContract:contract(21),members:[member(1,'2'),member(2,'3')],minimumBuyers:2};
const actual=previewRecurringCollective(input);
check('Two distinct buyers qualify',()=>assert.equal(actual.qualifying_buyers,2));
check('Compatible rice is summed exactly',()=>assert.equal(actual.products[0].total_quantity,'5.0000'));
check('Neither buyer is automatically charged',()=>assert.ok(actual.buyers.every(x=>x.payment_authorized===false)));
check('Each buyer must explicitly join the new cycle',()=>assert.ok(actual.buyers.every(x=>x.requires_cycle_join)));
check('No inventory or order side effects',()=>assert.equal(actual.reserves_stock||actual.creates_order,false));
check('A skipped buyer drops below minimum',()=>throws('COHORT_BELOW_MINIMUM',
 ()=>previewRecurringCollective({...input,members:[member(1,'2'),member(2,'3','SKIPPED')]})));
check('Distinct product family never pooled',()=>{
 const p=previewRecurringCollective({...input,members:[member(1),{...member(2),items:[{family_id:2,unit:'bag',quantity:'4'}]}]});
 assert.equal(p.products.length,2);
});
check('Different requirements stay separate physical matches',()=>{
 const b={...member(2),items:[{family_id:1,unit:'bag',quantity:'3',requirements:'Grade B'}]};
 assert.equal(previewRecurringCollective({...input,members:[member(1),b]}).products.length,2);
});
check('Fractional packaged units rejected',()=>throws('INVALID_COHORT_QUANTITY',
 ()=>previewRecurringCollective({...input,members:[member(1,'1.5'),member(2)]})));
check('Different weekday rejected',()=>throws('INCOMPATIBLE_COHORT_SCHEDULE',
 ()=>previewRecurringCollective({...input,members:[member(1),{...member(2),contract:{...contract(22),weekday_number:3}}]})));
check('Suspended contract rejected',()=>throws('INCOMPATIBLE_COHORT_SCHEDULE',
 ()=>previewRecurringCollective({...input,members:[member(1),{...member(2),contract:contract(22,'PAUSED')}]})));
check('Duplicate buyer rejected',()=>throws('DUPLICATE_COHORT_BUYER',
 ()=>previewRecurringCollective({...input,members:[member(1),member(1)]})));
check('Organizer must remain active',()=>throws('ORGANIZER_CONTRACT_INACTIVE',
 ()=>previewRecurringCollective({...input,organizerContract:contract(21,'PAUSED')})));
check('No recurring mandate bypass',()=>assert.equal(isCompatibleSchedule(contract(1),{...contract(2),payment_policy:'AUTO_CHARGE'}),false));
console.log('B6-N POLICY: '+n+'/'+n+' PASS');
