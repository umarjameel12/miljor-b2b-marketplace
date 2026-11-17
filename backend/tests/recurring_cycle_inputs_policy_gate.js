'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {normalizeCycleInputs}=require('../src/services/procurementRecurringCyclePolicy');
const items=[{id:31,line_number:1,family_id:7,unit:'bag',quantity:'2.0000',requirements:'Agreed request',allow_substitutions:0}];
const input=quantity=>({expected_revision:0,items:[{template_item_id:31,quantity}],delivery_preference:{mode:'PICKUP'}});
test('cycle edits preserve product identity, exact quantities and nonbinding preferences',()=>{
 const value=normalizeCycleInputs(items,input('3'));
 assert.equal(value.items[0].quantity,'3.0000');assert.equal(value.items[0].family_id,7);
 assert.equal(value.items[0].requirements,'Agreed request');assert.equal(value.expected_revision,0);
 assert.deepEqual(value.delivery_preference,{mode:'PICKUP',address_id:null});
});
test('rejects fractional packs, unknown lines, injected specifications, fees and invalid revision',()=>{
 for(const value of [input('1.5'),{...input('2'),items:[{template_item_id:99,quantity:'2'}]},
  {...input('2'),items:[{template_item_id:31,quantity:'2',family_id:8}]},
  {...input('2'),delivery_preference:{mode:'EXPRESS',address_id:4,fee:'1'}},
  {...input('2'),expected_revision:true},{...input('2'),expected_revision:-1},
  {...input('2'),delivery_preference:{mode:'STANDARD_CLUSTERED',address_id:0}},
  {...input('2'),payment_authorized:true}])assert.throws(()=>normalizeCycleInputs(items,value));
});
