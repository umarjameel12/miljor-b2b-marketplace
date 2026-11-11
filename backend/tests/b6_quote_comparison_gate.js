'use strict';
process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';
const assert = require('node:assert/strict');
const { compareQuoteOptions } = require('../src/services/procurementQuoteComparisonService');

let passed = 0;
const test = (title, fn) => { fn(); console.log('PASS:', title); passed++; };
const request = [{id:1,quantity:'100',unit:'kg'}, {id:2,quantity:'5',unit:'tin'}];
const future = new Date(Date.now()+86400000).toISOString();
const q = (id,supplier,lines,delivery='0') => ({
  id,supplier_id:supplier,lines,delivery_fee:delivery,valid_until:future,status:'SUBMITTED'
});
const line = (request_item_id, quantity, unit, unit_price, specification_match=true) =>
  ({request_item_id,quantity,unit,unit_price,specification_match});
const a = q(1,11,[line(1,'100','kg','265.00'),line(2,'5','tin','4000')],'1500');
const b = q(2,12,[line(1,'100','kg','250')],'2500');
const c = q(3,13,[line(2,'5','tin','3800')],'500');

test('Single supplier complete basket total', () => {
  const x=compareQuoteOptions({items:request,quotes:[a]});
  assert.equal(x.options[0].total_delivered_cost,'48000.00');
  assert.deepEqual(x.options[0].quote_ids,[1]);
});
test('Cheapest split supplier basket includes both delivery fees', () => {
  const x=compareQuoteOptions({items:request,quotes:[a,b,c]});
  assert.equal(x.options[0].total_delivered_cost,'47000.00');
  assert.deepEqual(x.options[0].quote_ids.sort(),[2,3]);
});
test('Expired quote ignored', () => {
  const x=compareQuoteOptions({items:request,quotes:[{...a,valid_until:new Date(Date.now()-60000).toISOString()}]});
  assert.equal(x.options.length,0);
  assert.equal(x.excluded[0].reason,'NOT_ACTIVE_OR_EXPIRED');
});
test('Incompatible physical specification never matched', () => {
  const x=compareQuoteOptions({items:request,quotes:[q(4,14,[line(1,'100','kg','200',false),line(2,'5','tin','1000')])]});
  assert.equal(x.options.length,0);
});
test('Different units excluded instead of silently converting', () => {
  const x=compareQuoteOptions({items:request,quotes:[q(4,14,[line(1,'100','bag','200'),line(2,'5','tin','1000')])]});
  assert.equal(x.options.length,0);
});
test('Quote missing item cannot become complete basket by itself', () => {
  const x=compareQuoteOptions({items:request,quotes:[b]});
  assert.equal(x.options.length,0);
});
test('Zero or negative quote unit price cannot win', () => {
  const x=compareQuoteOptions({items:request,quotes:[q(4,14,[line(1,'100','kg','0'),line(2,'5','tin','1000')])]});
  assert.equal(x.options.length,0);
});
test('Decimals use exact arithmetic without float drift', () => {
  const x=compareQuoteOptions({items:[{id:1,quantity:'0.1',unit:'kg'}],
    quotes:[q(1,11,[line(1,'0.1','kg','0.30')])]});
  assert.equal(x.options[0].total_delivered_cost,'0.03');
});
test('Duplicate request IDs fail closed', () => {
  assert.throws(()=>compareQuoteOptions({items:[...request,request[0]],quotes:[]}),x=>x.code==='INVALID_REQUEST_ITEMS');
});
test('Multiple alternatives from one supplier not double-awarded', () => {
  const alternative=q(10,11,[line(1,'100','kg','240'),line(2,'5','tin','3900')]);
  const x=compareQuoteOptions({items:request,quotes:[a,alternative]});
  assert.ok(x.options.every(z=>new Set(z.supplier_ids).size===z.supplier_ids.length));
});
test('Zero buyer fee defaults to zero', () => {
  const x=compareQuoteOptions({items:request,quotes:[a]});
  assert.equal(x.options[0].buyer_platform_fee_total,'0.00');
});
test('Too many quote combinations explicitly blocked', () => {
  const x=compareQuoteOptions({items:request,quotes:Array.from({length:9},(_,i)=>q(i+1,i+10,[line(1,'100','kg','250'),line(2,'5','tin','5000')]))});
  assert.equal(x.blocked,'TOO_MANY_QUOTES_FOR_EXACT_COMBINATION');
});
console.log(`B6 QUOTE COMPARISON PURE TESTS: ${passed}/${passed} PASS (pure JS, no database)`);
process.exit(0);
