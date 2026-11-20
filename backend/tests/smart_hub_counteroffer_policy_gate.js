'use strict';
const assert=require('node:assert/strict');
const {validateProductCounteroffers,validateSupplierDecision}=require('../src/services/procurementCounterofferPolicy');
const quoted=[{request_item_id:12,unit_price:'290.00'},{request_item_id:13,unit_price:'510.00'}];
const valid=validateProductCounteroffers({lines:[
  {request_item_id:12,proposed_unit_price:'270.50'},
  {request_item_id:13,proposed_unit_price:'490'}
]},quoted);
assert.deepEqual(valid,[
  {request_item_id:12,quoted_unit_price:'290.00',proposed_unit_price:'270.50'},
  {request_item_id:13,quoted_unit_price:'510.00',proposed_unit_price:'490.00'}
]);
const bad=(fn,code)=>assert.throws(fn,e=>e.code===code,code);
bad(()=>validateProductCounteroffers({message:'hello',lines:[{request_item_id:12,proposed_unit_price:'270'}]},quoted),'UNSUPPORTED_COUNTER_FIELD');
bad(()=>validateProductCounteroffers({lines:[]},quoted),'INVALID_COUNTEROFFER');
bad(()=>validateProductCounteroffers({lines:[{request_item_id:99,proposed_unit_price:'1'}]},quoted),'UNQUOTED_COUNTER_ITEM');
bad(()=>validateProductCounteroffers({lines:[{request_item_id:12,proposed_unit_price:'270'},{request_item_id:12,proposed_unit_price:'280'}]},quoted),'DUPLICATE_COUNTER_ITEM');
bad(()=>validateProductCounteroffers({lines:[{request_item_id:12,proposed_unit_price:'290'}]},quoted),'UNCHANGED_COUNTER_PRICE');
bad(()=>validateProductCounteroffers({lines:[{request_item_id:12,proposed_unit_price:'291'}]},quoted),'COUNTER_PRICE_ABOVE_QUOTE');
bad(()=>validateProductCounteroffers({lines:[{request_item_id:12,proposed_unit_price:'0'}]},quoted),'INVALID_COUNTER_PRICE');
bad(()=>validateProductCounteroffers({lines:[{request_item_id:12,proposed_unit_price:'270.001'}]},quoted),'INVALID_COUNTER_PRICE');
assert.deepEqual(validateSupplierDecision({decision:'ACCEPT'},{request_item_id:12}),{decision:'ACCEPT',request_item_id:12});
assert.deepEqual(validateSupplierDecision({decision:'REJECT'},{request_item_id:12}),{decision:'REJECT',request_item_id:12});
assert.deepEqual(validateSupplierDecision({decision:'COUNTER_AGAIN',proposed_unit_price:'280'},{request_item_id:12,buyer_proposed_unit_price:'270',quoted_unit_price:'290'}),
  {decision:'COUNTER_AGAIN',request_item_id:12,proposed_unit_price:'280.00'});
bad(()=>validateSupplierDecision({decision:'CHAT'},{request_item_id:12}),'INVALID_COUNTER_DECISION');
bad(()=>validateSupplierDecision({decision:'CHAT',message:'hello'},{request_item_id:12}),'UNSUPPORTED_COUNTER_FIELD');
bad(()=>validateSupplierDecision({decision:'ACCEPT',proposed_unit_price:'280'},{request_item_id:12}),'UNEXPECTED_COUNTER_PRICE');
bad(()=>validateSupplierDecision({decision:'COUNTER_AGAIN',proposed_unit_price:'300'},{request_item_id:12,buyer_proposed_unit_price:'270',quoted_unit_price:'290'}),'COUNTER_PRICE_OUT_OF_RANGE');
bad(()=>validateSupplierDecision({decision:'COUNTER_AGAIN',proposed_unit_price:'260'},{request_item_id:12,buyer_proposed_unit_price:'270',quoted_unit_price:'290'}),'COUNTER_PRICE_OUT_OF_RANGE');
console.log('PASS: Product-wise numeric counteroffer policy assertions');
